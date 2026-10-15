// Perfumería (etapa I7): variantes con stock propio, promos automáticas, regalo y cambios, y
// vencimientos por lote.
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  KIOSCO_B,
  nuevoKiosco,
  type Cliente,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let cajero: Cliente;
let kiosco: string;
let turnoId: string;
let grupo: string;
let promo: string;
const tonos: Record<string, string> = {};
let ventaPromo: string;

const dia = (n: number) =>
  new Date(Date.now() + n * 24 * 3600_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

const item = (tono: string, precioUnitario = 320000, cantidad = 1) => ({
  id: uuidv7(),
  productoId: tonos[tono]!,
  descripcion: `Esmalte cremoso ${tono}`,
  cantidad,
  precioUnitario,
});

function venta(extra: Record<string, unknown> & { total: number }) {
  return {
    tipo: 'venta',
    datos: {
      id: uuidv7(),
      turnoId,
      creadaEn: new Date().toISOString(),
      items: [item('Rojo'), item('Nude'), item('Coral')],
      pagos: extra.total > 0 ? [{ id: uuidv7(), medio: 'efectivo', monto: extra.total }] : [],
      ...extra,
    },
  };
}

async function sync(op: unknown) {
  const r = await cajero.post('/api/v1/sync', { ops: [op] });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ resultados: { estado: string; mensaje?: string }[] }>().resultados[0];
}

async function stock(id: string): Promise<number> {
  const { rows } = await e.admin.query<{ s: string }>(
    'select stock_actual as s from productos where id = $1',
    [id],
  );
  return Number(rows[0]?.s);
}

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  await e.admin.query(
    `update kioscos set rubro = 'perfumeria', modulos = '{variantes,promos,regalo,vencimientos}' where id = $1`,
    [kiosco],
  );
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
  ({ cajero } = await cajeroEnEquipo(dueno, e.app));
  turnoId = uuidv7();
  await cajero.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
    ],
  });
});
afterAll(async () => {
  await e.cerrar();
});

describe('variantes', () => {
  it('un producto en tres tonos: cada tono es un producto con su stock y su código', async () => {
    const maquillaje = (
      await dueno.cliente.post('/api/v1/categorias', { nombre: 'Maquillaje' })
    ).json<{ id: string }>().id;
    const r = await dueno.cliente.post('/api/v1/grupos-variantes', {
      nombre: 'Esmalte cremoso',
      tipo: 'tono',
      precio: 320000,
      costo: 150000,
      categoriaId: maquillaje,
      variantes: [
        { variante: 'Rojo', color: '#c0182b', codigo: '7790000000011', stockInicial: 10 },
        { variante: 'Nude', color: '#d8a48f', stockInicial: 10 },
        { variante: 'Coral', stockInicial: 10 },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    grupo = r.json<{ id: string }>().id;

    const g = (await cajero.get(`/api/v1/grupos-variantes/${grupo}`)).json<{
      variantes: { id: string; variante: string; stock: number; codigos: string[] }[];
    }>();
    expect(g.variantes.map((v) => [v.variante, v.stock])).toEqual([
      ['Coral', 10],
      ['Nude', 10],
      ['Rojo', 10],
    ]);
    for (const v of g.variantes) tonos[v.variante] = v.id;
    expect(g.variantes.find((v) => v.variante === 'Rojo')?.codigos).toEqual(['7790000000011']);

    const catalogo = (await cajero.get('/api/v1/catalogo')).json<{
      productos: {
        id: string;
        nombre: string;
        grupoId?: string;
        variante?: string;
        color?: string;
      }[];
      grupos: { id: string; nombre: string }[];
    }>();
    expect(catalogo.productos.find((p) => p.id === tonos.Rojo)).toMatchObject({
      nombre: 'Esmalte cremoso Rojo',
      grupoId: grupo,
      variante: 'Rojo',
      color: '#c0182b',
    });
    expect(catalogo.grupos).toEqual([{ id: grupo, nombre: 'Esmalte cremoso', tipo: 'tono' }]);
  });

  it('un tono más copia el precio; no se repite el nombre; renombrar el grupo renombra los tonos', async () => {
    const r = await dueno.cliente.post(`/api/v1/grupos-variantes/${grupo}/variantes`, {
      variante: 'Bordó',
      color: '#5e1224',
    });
    expect(r.statusCode, r.body).toBe(200);
    const bordo = (
      await dueno.cliente.get(`/api/v1/productos/${r.json<{ id: string }>().id}`)
    ).json();
    expect(bordo).toMatchObject({ nombre: 'Esmalte cremoso Bordó', precio: 320000, costo: 150000 });
    expect(
      (
        await dueno.cliente.post(`/api/v1/grupos-variantes/${grupo}/variantes`, {
          variante: 'rojo',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await cajero.post(`/api/v1/grupos-variantes/${grupo}/variantes`, { variante: 'Lila' }))
        .statusCode,
    ).toBe(403);

    await dueno.cliente.patch(`/api/v1/grupos-variantes/${grupo}`, { nombre: 'Esmalte' });
    expect((await dueno.cliente.get(`/api/v1/productos/${tonos.Rojo}`)).json()).toMatchObject({
      nombre: 'Esmalte Rojo',
    });
    await dueno.cliente.patch(`/api/v1/grupos-variantes/${grupo}`, { nombre: 'Esmalte cremoso' });
    // El tono se cambia desde el producto.
    const coca = (
      await dueno.cliente.post('/api/v1/productos', { nombre: 'Agua', precio: 1000 })
    ).json<{ id: string }>().id;
    expect(
      (await dueno.cliente.patch(`/api/v1/productos/${coca}`, { variante: 'Azul' })).statusCode,
    ).toBe(400);
  });
});

describe('promos', () => {
  it('solo dueño o encargado crean promos; la regla no se edita', async () => {
    const datos = { nombre: '3x2 en esmaltes', lleva: 3, paga: 2, descuento: 100, grupoId: grupo };
    expect((await cajero.post('/api/v1/promos', datos)).statusCode).toBe(403);
    expect((await dueno.cliente.post('/api/v1/promos', { ...datos, paga: 3 })).statusCode).toBe(
      400,
    );
    const r = await dueno.cliente.post('/api/v1/promos', datos);
    expect(r.statusCode, r.body).toBe(200);
    promo = r.json<{ id: string }>().id;
    expect((await dueno.cliente.patch(`/api/v1/promos/${promo}`, { lleva: 4 })).statusCode).toBe(
      400,
    );
    const catalogo = (await cajero.get('/api/v1/catalogo')).json<{ promos: { id: string }[] }>();
    expect(catalogo.promos).toEqual([
      {
        id: promo,
        nombre: '3x2 en esmaltes',
        lleva: 3,
        paga: 2,
        descuento: 100,
        categoriaId: null,
        grupoId: grupo,
        desde: null,
        hasta: null,
      },
    ]);
    const { rows } = await e.admin.query(
      `select accion from auditoria where kiosco_id = $1 and accion = 'promo.creada'`,
      [kiosco],
    );
    expect(rows).toHaveLength(1);
  });

  it('3 esmaltes de tonos distintos: aplica el 3x2 y baja el stock de cada tono', async () => {
    const op = venta({
      total: 640000,
      regalo: true,
      descuentos: [{ promoId: promo, monto: 320000 }],
    });
    ventaPromo = op.datos.id;
    expect(await sync(op)).toMatchObject({ estado: 'ok' });
    expect(await stock(tonos.Rojo!)).toBe(9);
    expect(await stock(tonos.Nude!)).toBe(9);
    expect(await stock(tonos.Coral!)).toBe(9);
    const v = (await cajero.get(`/api/v1/ventas/${ventaPromo}`)).json();
    expect(v).toMatchObject({
      total: 640000,
      regalo: true,
      descuentos: [{ promo_id: promo, descripcion: '3x2 en esmaltes', monto: 320000 }],
    });
    const tablero = (await dueno.cliente.get('/api/v1/tablero?periodo=hoy')).json();
    expect(tablero.promos).toEqual({ descontado: 320000, ventas: 1 });
  });

  it('el servidor no acepta más descuento del que da la regla', async () => {
    const dos = venta({
      total: 320000,
      items: [item('Rojo'), item('Nude')],
      descuentos: [{ promoId: promo, monto: 320000 }],
    });
    expect(await sync(dos)).toMatchObject({ estado: 'rechazada' });
    const deMas = venta({ total: 600000, descuentos: [{ promoId: promo, monto: 360000 }] });
    expect(await sync(deMas)).toMatchObject({
      estado: 'rechazada',
      mensaje: 'La promo no coincide con los productos.',
    });
    // Sin la promo en la venta, el total tiene que ser el de los productos.
    expect(await sync(venta({ total: 640000 }))).toMatchObject({ estado: 'rechazada' });
    expect(
      await sync(venta({ total: 640000, descuentos: [{ promoId: uuidv7(), monto: 320000 }] })),
    ).toMatchObject({ estado: 'rechazada', mensaje: 'Una promo de la venta no existe.' });
  });

  it('apagada no corre en el catálogo, pero las ventas hechas sin conexión antes se aceptan', async () => {
    const op = venta({ total: 640000, descuentos: [{ promoId: promo, monto: 320000 }] });
    await dueno.cliente.patch(`/api/v1/promos/${promo}`, { activa: false });
    expect((await cajero.get('/api/v1/catalogo')).json<{ promos: unknown[] }>().promos).toEqual([]);
    expect(await sync(op)).toMatchObject({ estado: 'ok' });
    await dueno.cliente.patch(`/api/v1/promos/${promo}`, { activa: true });
    // La fecha de fin no puede quedar en el pasado (para terminarla hoy, se apaga).
    expect(
      (await dueno.cliente.patch(`/api/v1/promos/${promo}`, { hasta: dia(-1) })).statusCode,
    ).toBe(400);
    // Una venta de un día en que la promo ya no corría se rechaza.
    const vieja = venta({ total: 640000, descuentos: [{ promoId: promo, monto: 320000 }] });
    await e.admin.query(`update promos set desde = $2 where id = $1`, [promo, dia(1)]);
    expect(await sync(vieja)).toMatchObject({ estado: 'rechazada' });
    await e.admin.query(`update promos set desde = null where id = $1`, [promo]);
    const lista = (await dueno.cliente.get('/api/v1/promos')).json();
    expect(lista[0]).toMatchObject({
      alcance: 'Esmalte cremoso',
      estado: 'corriendo',
      ventas30: 2,
    });
  });
});

describe('promos sin la función', () => {
  it('si el comercio apaga las promos, el catálogo no las manda', async () => {
    await e.admin.query(`update kioscos set modulos = '{variantes}' where id = $1`, [kiosco]);
    expect((await cajero.get('/api/v1/catalogo')).json<{ promos: unknown[] }>().promos).toEqual([]);
    await e.admin.query(
      `update kioscos set modulos = '{variantes,promos,regalo,vencimientos}' where id = $1`,
      [kiosco],
    );
  });
});

describe('cambios', () => {
  let itemRojo: string;
  let cambio: string;
  let cambioIgual: string;

  it('se busca la venta por el código del ticket de cambio o por el producto', async () => {
    const codigo = ventaPromo.slice(-8).toUpperCase();
    const r = await cajero.get(`/api/v1/cambios/ventas?codigo=${codigo}`);
    expect(r.statusCode, r.body).toBe(200);
    const { ventas } = r.json<{
      ventas: {
        id: string;
        codigo: string;
        suma: number;
        descuentos: number;
        items: { id: string; productoId: string; devuelto: number }[];
      }[];
    }>();
    expect(ventas).toHaveLength(1);
    expect(ventas[0]).toMatchObject({ id: ventaPromo, codigo, suma: 960000, descuentos: 320000 });
    itemRojo = ventas[0]!.items.find((i) => i.productoId === tonos.Rojo)!.id;
    const porProducto = (await cajero.get(`/api/v1/cambios/ventas?productoId=${tonos.Rojo}`)).json<{
      ventas: { id: string }[];
    }>();
    expect(porProducto.ventas.map((v) => v.id)).toContain(ventaPromo);
  });

  it('devuelve un tono al precio que pagó (con su parte del 3x2) y se lleva otro', async () => {
    // El Rojo salió $2.133,33 (3x2 de $3.200): el Coral nuevo cuesta $3.200, paga $1.066,67.
    const op = venta({
      total: 106667,
      items: [item('Coral')],
      cambio: { ventaId: ventaPromo, items: [{ itemId: itemRojo, cantidad: 1 }] },
    });
    cambio = op.datos.id;
    expect(await sync(op)).toMatchObject({ estado: 'ok' });
    expect(await stock(tonos.Rojo!)).toBe(9 - 1 + 1);
    expect(await stock(tonos.Coral!)).toBe(9 - 1 - 1);
    const v = (await cajero.get(`/api/v1/ventas/${cambio}`)).json();
    expect(v.devoluciones).toEqual([
      expect.objectContaining({ venta_item_id: itemRojo, cantidad: 1, importe: 213333 }),
    ]);
    // Lo mismo no se cambia dos veces.
    expect(
      await sync(
        venta({
          total: 106667,
          items: [item('Coral')],
          cambio: { ventaId: ventaPromo, items: [{ itemId: itemRojo, cantidad: 1 }] },
        }),
      ),
    ).toMatchObject({ estado: 'rechazada', mensaje: 'Esmalte cremoso Rojo ya se cambió.' });
  });

  it('lo que se lleva no puede valer menos; un cambio por lo mismo no tiene pago', async () => {
    const { rows } = await e.admin.query<{ id: string }>(
      'select id from venta_items where venta_id = $1',
      [cambio],
    );
    const coral = rows[0]!.id;
    expect(
      await sync(
        venta({
          total: 0,
          items: [item('Nude', 100000)],
          cambio: { ventaId: cambio, items: [{ itemId: coral, cantidad: 1 }] },
        }),
      ),
    ).toMatchObject({
      estado: 'rechazada',
      mensaje: 'Lo que se lleva tiene que valer lo mismo o más que lo que devuelve.',
    });
    const igual = venta({
      total: 0,
      items: [item('Nude')],
      cambio: { ventaId: cambio, items: [{ itemId: coral, cantidad: 1 }] },
    });
    cambioIgual = igual.datos.id;
    expect(await sync(igual)).toMatchObject({ estado: 'ok' });
    expect(await stock(tonos.Coral!)).toBe(8);
    expect(await stock(tonos.Nude!)).toBe(7);
  });

  it('anular el cambio vuelve todo atrás y lo devuelto se puede cambiar otra vez', async () => {
    // El Coral de ese cambio se volvió a cambiar: primero se anula el último cambio.
    expect(
      (await dueno.cliente.post(`/api/v1/ventas/${cambio}/anular`, { motivo: 'Se equivocó' }))
        .statusCode,
    ).toBe(409);
    await dueno.cliente.post(`/api/v1/ventas/${cambioIgual}/anular`, { motivo: 'Se equivocó' });
    const r = await dueno.cliente.post(`/api/v1/ventas/${cambio}/anular`, {
      motivo: 'Se equivocó de tono',
    });
    expect(r.statusCode, r.body).toBe(200);
    // Todo como después de la venta con el 3x2: el Rojo devuelto sale otra vez.
    expect(await stock(tonos.Rojo!)).toBe(8);
    expect(await stock(tonos.Coral!)).toBe(8);
    expect(await stock(tonos.Nude!)).toBe(8);
    const { ventas } = (
      await cajero.get(`/api/v1/cambios/ventas?codigo=${ventaPromo.slice(-8)}`)
    ).json<{ ventas: { items: { id: string; devuelto: number }[] }[] }>();
    expect(ventas[0]!.items.find((i) => i.id === itemRojo)?.devuelto).toBe(0);
  });

  it('una venta con algo cambiado no se anula hasta anular el cambio', async () => {
    const original = venta({ total: 640000, descuentos: [{ promoId: promo, monto: 320000 }] });
    await sync(original);
    const { rows } = await e.admin.query<{ id: string; producto_id: string }>(
      'select id, producto_id from venta_items where venta_id = $1',
      [original.datos.id],
    );
    const rojo = rows.find((x) => x.producto_id === tonos.Rojo)!.id;
    const cambioOp = venta({
      total: 106667,
      items: [item('Coral')],
      cambio: { ventaId: original.datos.id, items: [{ itemId: rojo, cantidad: 1 }] },
    });
    await sync(cambioOp);
    const antes = { rojo: await stock(tonos.Rojo!), coral: await stock(tonos.Coral!) };
    // Anular la original devolvería dos veces la plata de lo cambiado.
    const r = await dueno.cliente.post(`/api/v1/ventas/${original.datos.id}/anular`, {
      motivo: 'Prueba',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain('Primero anulá el cambio');
    // En orden: primero el cambio, después la venta. El stock queda como antes de las dos.
    await dueno.cliente.post(`/api/v1/ventas/${cambioOp.datos.id}/anular`, { motivo: 'Prueba' });
    const r2 = await dueno.cliente.post(`/api/v1/ventas/${original.datos.id}/anular`, {
      motivo: 'Prueba',
    });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(await stock(tonos.Rojo!)).toBe(antes.rojo - 1 + 1);
    expect(await stock(tonos.Coral!)).toBe(antes.coral + 1 + 1);
  });
});

describe('vencimientos', () => {
  it('lotes que vencen pronto, vencidos y retirados', async () => {
    const l1 = await dueno.cliente.post('/api/v1/lotes', {
      productoId: tonos.Rojo,
      venceEn: dia(10),
      cantidad: 6,
    });
    expect(l1.statusCode, l1.body).toBe(200);
    await dueno.cliente.post('/api/v1/lotes', {
      productoId: tonos.Nude,
      venceEn: dia(-2),
      cantidad: 3,
    });
    await dueno.cliente.post('/api/v1/lotes', {
      productoId: tonos.Coral,
      venceEn: dia(200),
      cantidad: 3,
    });
    expect(
      (await cajero.post('/api/v1/lotes', { productoId: tonos.Rojo, venceEn: dia(5), cantidad: 1 }))
        .statusCode,
    ).toBe(403);
    const v = (await cajero.get('/api/v1/vencimientos')).json<{
      lotes: { nombre: string; vencido: boolean; venceEn: string }[];
    }>();
    expect(v.lotes.map((l) => [l.nombre, l.vencido])).toEqual([
      ['Esmalte cremoso Nude', true],
      ['Esmalte cremoso Rojo', false],
    ]);
    const tablero = (await dueno.cliente.get('/api/v1/tablero')).json();
    expect(tablero.porVencer).toMatchObject({ lotes: 2, vencidos: 1 });
    const ficha = (await dueno.cliente.get(`/api/v1/productos/${tonos.Rojo}`)).json();
    expect(ficha.lotes).toEqual([
      { id: l1.json<{ id: string }>().id, venceEn: dia(10), cantidad: 6 },
    ]);
    await dueno.cliente.post(`/api/v1/lotes/${l1.json<{ id: string }>().id}/retirar`, {});
    expect((await cajero.get('/api/v1/vencimientos')).json().lotes).toHaveLength(1);
  });
});

describe('exportación para el contador', () => {
  it('el CSV de ventas muestra lo descontado por promos y lo devuelto en cambios', async () => {
    const r = await dueno.cliente.get(
      `/api/v1/exportar/ventas.csv?desde=${dia(0)}&hasta=${dia(0)}`,
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toContain(';6400,00;3200,00;Efectivo;Cobrada;');
    expect(r.body).toContain('cambio: devuelve 1 x Esmalte cremoso Rojo (2133,33)');
  });
});

describe('promos y cambios de catálogo', () => {
  it('una venta sin conexión con la promo se acepta aunque el producto haya cambiado de grupo, y queda para revisar', async () => {
    const op = venta({ total: 640000, descuentos: [{ promoId: promo, monto: 320000 }] });
    await e.admin.query(`update productos set grupo_id = null, variante = null where id = $1`, [
      tonos.Coral,
    ]);
    expect(await sync(op)).toMatchObject({ estado: 'ok' });
    await e.admin.query(`update productos set grupo_id = $2, variante = 'Coral' where id = $1`, [
      tonos.Coral,
      grupo,
    ]);
    const { rows } = await e.admin.query(
      `select 1 from auditoria where kiosco_id = $1 and accion = 'promo.revisar'`,
      [kiosco],
    );
    expect(rows).toHaveLength(1);
    // Igual tiene tope: no se acepta más que la regla con todo adentro.
    expect(
      await sync(venta({ total: 0, descuentos: [{ promoId: promo, monto: 960000 }] })),
    ).toMatchObject({ estado: 'rechazada' });
  });
});

describe('plazo de los cambios', () => {
  it('el cajero cambia hasta 30 días después de la venta; el dueño, hasta 90', async () => {
    const vieja = venta({ total: 960000, items: [item('Nude'), item('Nude'), item('Nude')] });
    await sync(vieja);
    await e.admin.query(
      `update ventas set creada_en_dispositivo = now() - interval '40 days' where id = $1`,
      [vieja.datos.id],
    );
    const { rows } = await e.admin.query<{ id: string }>(
      'select id from venta_items where venta_id = $1 limit 1',
      [vieja.datos.id],
    );
    const op = () =>
      venta({
        total: 0,
        items: [item('Nude')],
        cambio: { ventaId: vieja.datos.id, items: [{ itemId: rows[0]!.id, cantidad: 1 }] },
      });
    expect(await sync(op())).toMatchObject({
      estado: 'rechazada',
      mensaje:
        'Esa venta es de hace más de 30 días. El cambio lo puede hacer el dueño o el encargado.',
    });
    const r = await dueno.cliente.post('/api/v1/sync', { ops: [op()] });
    expect(r.json().resultados[0]).toMatchObject({ estado: 'ok' });
    const { rows: audit } = await e.admin.query(
      `select 1 from auditoria where kiosco_id = $1 and accion = 'venta.cambio'`,
      [kiosco],
    );
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe('aislamiento en las ventas', () => {
  it('una venta no puede usar una promo, una venta ni un cliente de otro comercio', async () => {
    const otro = async (tabla: string) =>
      (
        await e.admin.query<{ id: string }>(
          `select id from ${tabla} where kiosco_id = $1 limit 1`,
          [KIOSCO_B],
        )
      ).rows[0]!.id;
    const promoB = await otro('promos');
    const ventaB = await otro('ventas');
    const itemB = await otro('venta_items');
    const clienteB = await otro('clientes');
    const huella = async () =>
      (
        await e.admin.query(
          `select (select count(*) from ventas where kiosco_id = $1) as v,
                  (select count(*) from devoluciones where kiosco_id = $1) as d,
                  (select coalesce(sum(monto), 0) from movimientos_cuenta where kiosco_id = $1) as m`,
          [KIOSCO_B],
        )
      ).rows[0];
    const antes = await huella();
    expect(
      await sync(venta({ total: 640000, descuentos: [{ promoId: promoB, monto: 320000 }] })),
    ).toMatchObject({ estado: 'rechazada', mensaje: 'Una promo de la venta no existe.' });
    expect(
      await sync(
        venta({
          total: 0,
          items: [item('Nude')],
          cambio: { ventaId: ventaB, items: [{ itemId: itemB, cantidad: 1 }] },
        }),
      ),
    ).toMatchObject({ estado: 'rechazada', mensaje: 'La venta del cambio no existe.' });
    const aCuenta = venta({ total: 960000, clienteId: clienteB });
    aCuenta.datos.pagos = [{ id: uuidv7(), medio: 'cuenta_corriente', monto: 960000 }];
    expect(await sync(aCuenta)).toMatchObject({ estado: 'rechazada' });
    expect(await huella()).toEqual(antes);
  });
});
