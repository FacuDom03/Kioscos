// API para los comercios y avisos automáticos (docs/API.md).
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrabajoAviso } from '../src/cola.ts';
import {
  activarModulos,
  altaConInvitacion,
  Cliente,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
const encolados: TrabajoAviso[] = [];

beforeAll(async () => {
  e = await crearEntorno({
    encolarAviso: async (t) => {
      encolados.push(t);
    },
    // Toda dirección "resuelve" a una IP interna: el aviso de prueba no tiene que salir.
    opcionesEnvio: {
      resolver: (_h, _o, listo) => listo(null, [{ address: '10.0.0.5', family: 4 }]),
    },
  });
});
afterAll(async () => {
  await e.cerrar();
});

async function comercio() {
  const kioscoId = await nuevoKiosco(e.admin);
  const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
  return { kioscoId, dueno };
}

async function nuevaClave(dueno: Persona, clientes = false) {
  const r = await dueno.cliente.post('/api/v1/claves-api', { nombre: 'n8n', clientes });
  expect(r.statusCode, r.body).toBe(200);
  const datos = r.json<{ id: string; clave: string; prefijo: string }>();
  const c = new Cliente(e.app);
  c.origen = null;
  c.clave = datos.clave;
  return { ...datos, c };
}

const turnos = new Map<Persona, string>();

/** Registra una venta en efectivo; la primera vez abre la caja. */
async function vender(dueno: Persona, productoId: string, cantidad: number, precio: number) {
  const ops: unknown[] = [];
  let turnoId = turnos.get(dueno);
  if (!turnoId) {
    turnoId = uuidv7();
    turnos.set(dueno, turnoId);
    ops.push({
      tipo: 'apertura',
      datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
    });
  }
  const ventaId = uuidv7();
  ops.push({
    tipo: 'venta',
    datos: {
      id: ventaId,
      turnoId,
      creadaEn: new Date().toISOString(),
      total: cantidad * precio,
      items: [
        { id: uuidv7(), productoId, descripcion: 'Alfajor', cantidad, precioUnitario: precio },
      ],
      pagos: [{ id: uuidv7(), medio: 'efectivo', monto: cantidad * precio }],
    },
  });
  const r = await dueno.cliente.post('/api/v1/sync', { ops });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json<{ resultados: { estado: string }[] }>().resultados.at(-1)?.estado).toBe('ok');
  return ventaId;
}

describe('claves de API', () => {
  it('la clave se ve una sola vez, entra a la API y no a las rutas internas', async () => {
    const { dueno } = await comercio();
    const { clave, prefijo, c } = await nuevaClave(dueno);
    expect(clave).toMatch(/^mst_[A-Za-z0-9_-]{43}$/);
    expect(clave.startsWith(prefijo)).toBe(true);

    const lista = (await dueno.cliente.get('/api/v1/claves-api')).body;
    expect(lista).toContain(prefijo);
    expect(lista).not.toContain(clave);

    const negocio = await c.get('/api/externa/v1/negocio');
    expect(negocio.statusCode).toBe(200);
    expect(negocio.json()).toMatchObject({ rubro: expect.any(String), permisos: [] });
    // La clave no sirve para la app, y la sesión de la app no sirve para la API.
    expect((await c.get('/api/v1/productos')).statusCode).toBe(401);
    expect((await dueno.cliente.get('/api/externa/v1/negocio')).statusCode).toBe(401);
  });

  it('revocar corta el acceso en el momento y queda en la actividad', async () => {
    const { kioscoId, dueno } = await comercio();
    const { id, c } = await nuevaClave(dueno);
    expect((await dueno.cliente.delete(`/api/v1/claves-api/${id}`)).statusCode).toBe(200);
    expect((await c.get('/api/externa/v1/negocio')).statusCode).toBe(401);
    expect((await dueno.cliente.delete(`/api/v1/claves-api/${id}`)).statusCode).toBe(404);
    const { rows } = await e.admin.query<{ accion: string }>(
      `select accion from auditoria where kiosco_id = $1 and accion like 'clave_api.%' order by created_at`,
      [kioscoId],
    );
    expect(rows.map((r) => r.accion)).toEqual(['clave_api.creada', 'clave_api.revocada']);
  });

  it('si quien la creó deja de ser dueño, la clave deja de andar', async () => {
    const { kioscoId, dueno } = await comercio();
    const { c } = await nuevaClave(dueno);
    await e.admin.query(
      `update membresias set activa = false where kiosco_id = $1 and rol = 'dueno'`,
      [kioscoId],
    );
    expect((await c.get('/api/externa/v1/negocio')).statusCode).toBe(401);
  });

  it('solo el dueño maneja claves', async () => {
    const { kioscoId } = await comercio();
    const encargado = await altaConInvitacion(e.app, e.admin, kioscoId, 'encargado');
    const r = await encargado.cliente.post('/api/v1/claves-api', { nombre: 'x', clientes: false });
    expect(r.statusCode).toBe(403);
    expect((await encargado.cliente.get('/api/v1/claves-api')).statusCode).toBe(403);
  });

  it('una clave inventada o mal escrita no entra', async () => {
    const c = new Cliente(e.app);
    c.origen = null;
    for (const clave of [`mst_${'a'.repeat(43)}`, 'mst_corta', 'cualquier cosa']) {
      c.clave = clave;
      const r = await c.get('/api/externa/v1/negocio');
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ codigo: 'clave_invalida' });
    }
  });

  it('los clientes solo con permiso, y cada lectura queda en la actividad', async () => {
    const { kioscoId, dueno } = await comercio();
    await activarModulos(e.admin, kioscoId, ['cuenta_corriente']);
    const alta = await dueno.cliente.post('/api/v1/clientes', {
      nombre: 'Rosa',
      telefono: '11 5555-0000',
    });
    expect(alta.statusCode, alta.body).toBe(200);
    const sinPermiso = await nuevaClave(dueno);
    expect((await sinPermiso.c.get('/api/externa/v1/clientes')).statusCode).toBe(403);
    const conPermiso = await nuevaClave(dueno, true);
    const r = await conPermiso.c.get('/api/externa/v1/clientes');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      datos: [{ nombre: 'Rosa', telefono: '11 5555-0000', saldo: 0 }],
    });
    const { rows } = await e.admin.query(
      `select usuario_id, detalle from auditoria where kiosco_id = $1 and accion = 'api.clientes'`,
      [kioscoId],
    );
    expect(rows).toEqual([{ usuario_id: null, detalle: { clave: conPermiso.id, filas: 1 } }]);
  });

  it('productos paginados con sus códigos, ventas y resumen del día', async () => {
    const { dueno } = await comercio();
    const ids: string[] = [];
    for (const [i, nombre] of ['Alfajor', 'Chicle', 'Turrón'].entries()) {
      const r = await dueno.cliente.post('/api/v1/productos', {
        nombre,
        precio: 100000 * (i + 1),
        stockInicial: 10,
        codigos: [`77900000000${i}`],
      });
      ids.push(r.json<{ id: string }>().id);
    }
    const { c } = await nuevaClave(dueno);
    const p1 = (await c.get('/api/externa/v1/productos?limite=2')).json<{
      datos: { nombre: string; codigos: string[] }[];
      siguiente: string | null;
    }>();
    expect(p1.datos.map((p) => p.nombre)).toEqual(['Alfajor', 'Chicle']);
    expect(p1.datos[0]!.codigos).toEqual(['779000000000']);
    const p2 = (await c.get(`/api/externa/v1/productos?limite=2&despues=${p1.siguiente}`)).json<{
      datos: { nombre: string }[];
      siguiente: string | null;
    }>();
    expect(p2).toMatchObject({ datos: [{ nombre: 'Turrón' }], siguiente: null });

    const ventaId = await vender(dueno, ids[0]!, 3, 100000);
    const ventas = (await c.get('/api/externa/v1/ventas')).json<{ datos: unknown[] }>();
    expect(ventas.datos).toEqual([
      expect.objectContaining({
        id: ventaId,
        total: 300000,
        estado: 'cobrada',
        medios: ['efectivo'],
      }),
    ]);
    const venta = (await c.get(`/api/externa/v1/ventas/${ventaId}`)).json();
    expect(venta).toMatchObject({
      items: [{ productoId: ids[0], cantidad: 3, precioUnitario: 100000, subtotal: 300000 }],
      pagos: [{ medio: 'efectivo', monto: 300000, estado: 'aprobado' }],
    });
    expect((await c.get('/api/externa/v1/resumen')).json()).toMatchObject({
      ventas: 1,
      total: 300000,
      ticketPromedio: 300000,
      porMedio: { efectivo: 300000 },
      anuladas: 0,
    });
    // Datos inválidos: un campo de más o un período al revés.
    expect((await c.get('/api/externa/v1/ventas?kioscoId=x')).statusCode).toBe(400);
    expect(
      (await c.get('/api/externa/v1/ventas?desde=2026-10-10&hasta=2026-10-01')).statusCode,
    ).toBe(400);
  });

  it('cada clave tiene su propio límite de pedidos por minuto', async () => {
    const { dueno } = await comercio();
    const { c } = await nuevaClave(dueno);
    let ultimo = 0;
    for (let i = 0; i < 121; i++) ultimo = (await c.get('/api/externa/v1/negocio')).statusCode;
    expect(ultimo).toBe(429);
    // Otra clave del mismo comercio no queda frenada.
    expect((await (await nuevaClave(dueno)).c.get('/api/externa/v1/negocio')).statusCode).toBe(200);
  });
});

describe('avisos automáticos', () => {
  it('rechaza direcciones sin https o de una red interna', async () => {
    const { dueno } = await comercio();
    for (const [url, mensaje] of [
      ['http://n8n.ejemplo.com/webhook/x', 'https://'],
      ['https://10.0.0.8/webhook', 'red interna'],
      ['https://localhost/webhook', 'red interna'],
      ['https://usuario:clave@n8n.ejemplo.com/x', 'usuario ni contraseña'],
    ] as const) {
      const r = await dueno.cliente.post('/api/v1/avisos', { url, eventos: ['venta.creada'] });
      expect(r.statusCode, url).toBe(400);
      expect(r.json<{ error: string }>().error).toContain(mensaje);
    }
  });

  it('una venta, la anulación, una compra y el stock bajo generan sus avisos', async () => {
    const { kioscoId, dueno } = await comercio();
    const alta = await dueno.cliente.post('/api/v1/avisos', {
      url: 'https://n8n.ejemplo.com/webhook/ventas',
      eventos: ['venta.creada', 'venta.anulada', 'compra.creada', 'stock.bajo'],
    });
    expect(alta.statusCode, alta.body).toBe(200);
    expect(alta.json<{ secreto: string }>().secreto).toMatch(/^whsec_/);
    expect((await dueno.cliente.get('/api/v1/avisos')).body).not.toContain('whsec_');

    const producto = (
      await dueno.cliente.post('/api/v1/productos', {
        nombre: 'Alfajor',
        precio: 100000,
        stockInicial: 5,
        minimo: 3,
      })
    ).json<{ id: string }>().id;
    encolados.length = 0;

    // De 5 a 3: llega al mínimo, se avisa. De 3 a 2: ya estaba bajo, no se repite.
    const venta = await vender(dueno, producto, 2, 100000);
    await vender(dueno, producto, 1, 100000);
    const eventos = encolados.filter((t) => t.kioscoId === kioscoId).map((t) => t.aviso.evento);
    expect(eventos).toEqual(['venta.creada', 'stock.bajo', 'venta.creada']);
    expect(encolados[0]!.aviso).toMatchObject({
      id: expect.any(String),
      creado: expect.any(String),
      datos: { id: venta, total: 200000, estado: 'cobrada' },
    });
    expect(encolados[1]!.aviso.datos).toEqual({
      productos: [{ id: producto, nombre: 'Alfajor', stock: 3, minimo: 3 }],
    });

    encolados.length = 0;
    await dueno.cliente.post(`/api/v1/ventas/${venta}/anular`, { motivo: 'Se equivocó' });
    await dueno.cliente.post('/api/v1/compras', {
      items: [{ productoId: producto, cantidad: 10, costoUnitario: 50000 }],
    });
    expect(encolados.map((t) => t.aviso.evento)).toEqual(['venta.anulada', 'compra.creada']);
    expect(encolados[0]!.aviso.datos).toMatchObject({
      estado: 'anulada',
      motivoAnulacion: 'Se equivocó',
    });
    expect(encolados[1]!.aviso.datos).toMatchObject({ total: 500000 });
  });

  it('sin avisos configurados no se encola nada', async () => {
    const { dueno } = await comercio();
    const producto = (
      await dueno.cliente.post('/api/v1/productos', { nombre: 'Chicle', precio: 5000 })
    ).json<{ id: string }>().id;
    encolados.length = 0;
    await vender(dueno, producto, 1, 5000);
    expect(encolados).toEqual([]);
  });

  it('la prueba no sale si la dirección resuelve a una red interna, y lo anota', async () => {
    const { dueno } = await comercio();
    const { id } = (
      await dueno.cliente.post('/api/v1/avisos', {
        url: 'https://n8n.ejemplo.com/webhook/x',
        eventos: ['venta.creada'],
      })
    ).json<{ id: string }>();
    const r = await dueno.cliente.post(`/api/v1/avisos/${id}/probar`, {});
    expect(r.json()).toEqual({ enviado: false, estado: 'La dirección apunta a una red interna.' });
    const lista = (await dueno.cliente.get('/api/v1/avisos')).json<
      { ultimoEstado: string; fallosSeguidos: number }[]
    >();
    expect(lista[0]).toMatchObject({
      ultimoEstado: 'La dirección apunta a una red interna.',
      fallosSeguidos: 1,
    });
    // Pausar y volver a activar (vuelve a cero los errores).
    expect((await dueno.cliente.patch(`/api/v1/avisos/${id}`, { activo: false })).statusCode).toBe(
      200,
    );
    expect((await dueno.cliente.patch(`/api/v1/avisos/${id}`, { activo: true })).statusCode).toBe(
      200,
    );
    expect((await dueno.cliente.get('/api/v1/avisos')).json()).toMatchObject([
      { activo: true, fallosSeguidos: 0 },
    ]);
    expect((await dueno.cliente.delete(`/api/v1/avisos/${id}`)).statusCode).toBe(200);
    expect((await dueno.cliente.get('/api/v1/avisos')).json()).toEqual([]);
  });
});
