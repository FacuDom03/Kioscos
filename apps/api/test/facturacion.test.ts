// Facturación electrónica ARCA (docs/FACTURACION.md) contra un Afip SDK + ARCA falsos.
import { ClienteAfipSdk, procesarComprobante, type Facturador } from '@mostrador/servidor';
import { puntoDeVentaDePrueba, uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AfipFalso } from './afip-falso.ts';
import {
  activarModulos,
  altaConInvitacion,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

const CUIT_COMERCIO = '20123456786';
const afip = new AfipFalso();
const enPrueba: Facturador = {
  cliente: new ClienteAfipSdk({ accessToken: 'x', produccion: false, fetch: afip.fetch }),
  prueba: true,
};
const enProduccion: Facturador = {
  cliente: new ClienteAfipSdk({ accessToken: 'x', produccion: true, fetch: afip.fetch }),
  prueba: false,
};
/** Comprobantes que la API mandó a la cola (la cola real es el worker). */
const encolados: { kioscoId: string; comprobanteId: string }[] = [];

let e: Entorno; // modo de prueba
let p: Entorno; // producción
beforeAll(async () => {
  const encolarFactura = async (t: { kioscoId: string; comprobanteId: string }) => {
    encolados.push(t);
  };
  e = await crearEntorno({
    facturacion: { facturador: enPrueba, cuitMostrador: '20409378472' },
    encolarFactura,
  });
  p = await crearEntorno({
    facturacion: { facturador: enProduccion, cuitMostrador: '20409378472' },
    encolarFactura,
  });
});
afterAll(async () => {
  await e.cerrar();
  await p.cerrar();
});

const datos = {
  cuit: CUIT_COMERCIO,
  razonSocial: 'Kiosco Anita',
  condicion: 'monotributo',
  puntoVenta: 3,
  domicilio: 'Av. Siempreviva 742',
};

async function comercio(ent: Entorno, prender = true) {
  const kioscoId = await nuevoKiosco(ent.admin);
  const dueno = await altaConInvitacion(ent.app, ent.admin, kioscoId);
  if (prender) await activarModulos(ent.admin, kioscoId, ['facturacion']);
  const producto = (
    await dueno.cliente.post('/api/v1/productos', { nombre: 'Alfajor', precio: 150000 })
  ).json<{ id: string }>().id;
  return { kioscoId, dueno, producto };
}

const turnos = new Map<Persona, string>();
async function vender(dueno: Persona, producto: string, creadaEn = new Date()) {
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
  const id = uuidv7();
  ops.push({
    tipo: 'venta',
    datos: {
      id,
      turnoId,
      creadaEn: creadaEn.toISOString(),
      total: 300000,
      items: [
        {
          id: uuidv7(),
          productoId: producto,
          descripcion: 'Alfajor',
          cantidad: 2,
          precioUnitario: 150000,
        },
      ],
      pagos: [{ id: uuidv7(), medio: 'efectivo', monto: 300000 }],
    },
  });
  const r = await dueno.cliente.post('/api/v1/sync', { ops });
  expect(r.json<{ resultados: { estado: string }[] }>().resultados.at(-1)?.estado).toBe('ok');
  return id;
}

/** Lo que haría el worker con todo lo encolado de ese comercio. */
async function procesarCola(ent: Entorno, kioscoId: string, f: Facturador) {
  const mios = encolados.filter((t) => t.kioscoId === kioscoId);
  encolados.splice(0, encolados.length, ...encolados.filter((t) => t.kioscoId !== kioscoId));
  return Promise.all(mios.map((t) => procesarComprobante(ent.base, kioscoId, t.comprobanteId, f)));
}

const comprobantes = (ent: Entorno, ventaId: string) =>
  ent.admin
    .query<{
      id: string;
      tipo: string;
      numero: number | null;
      estado: string;
      cae: string | null;
      ultimo_error: string | null;
      anula_id: string | null;
      prueba: boolean;
    }>(
      'select id, tipo, numero, estado, cae, ultimo_error, anula_id, prueba from comprobantes where venta_id = $1 order by created_at',
      [ventaId],
    )
    .then((r) => r.rows);

describe('alta de la facturación', () => {
  it('sin la función prendida no se configura, y con ella queda activa en modo de prueba', async () => {
    const { dueno, kioscoId } = await comercio(e, false);
    expect((await dueno.cliente.get('/api/v1/facturacion')).json()).toMatchObject({
      disponible: true,
      prueba: true,
      activo: false,
      config: null,
    });
    expect((await dueno.cliente.post('/api/v1/facturacion/config', datos)).statusCode).toBe(409);
    expect(
      (await dueno.cliente.put('/api/v1/facturacion/modulo', { activo: true })).statusCode,
    ).toBe(200);
    const r = await dueno.cliente.post('/api/v1/facturacion/config', datos);
    expect(r.json()).toEqual({ activa: true, mensaje: null });
    expect((await dueno.cliente.get('/api/v1/facturacion')).json()).toMatchObject({
      activo: true,
      config: { cuit: CUIT_COMERCIO, estado: 'activa', puntoVenta: 3 },
    });
    const { rows } = await e.admin.query(
      `select accion from auditoria where kiosco_id = $1 and accion like 'facturacion.%' order by created_at`,
      [kioscoId],
    );
    expect(rows.map((x: { accion: string }) => x.accion)).toEqual([
      'facturacion.prendida',
      'facturacion.datos',
    ]);
  });

  it('rechaza un CUIT mal escrito y, por ahora, al responsable inscripto', async () => {
    const { dueno } = await comercio(e);
    const mal = await dueno.cliente.post('/api/v1/facturacion/config', {
      ...datos,
      cuit: '20123456787',
    });
    expect(mal.statusCode).toBe(400);
    const ri = await dueno.cliente.post('/api/v1/facturacion/config', {
      ...datos,
      condicion: 'responsable_inscripto',
    });
    expect(ri.statusCode).toBe(409);
  });

  it('en producción espera la autorización en ARCA y el punto de venta', async () => {
    const { dueno } = await comercio(p);
    const sinAutorizar = (await dueno.cliente.post('/api/v1/facturacion/config', datos)).json();
    expect(sinAutorizar).toMatchObject({ activa: false });
    expect((await dueno.cliente.get('/api/v1/facturacion')).json()).toMatchObject({
      config: { estado: 'pendiente', error: expect.stringContaining('autorización') },
    });
    afip.autorizados.add(CUIT_COMERCIO);
    const sinPunto = (await dueno.cliente.post('/api/v1/facturacion/verificar', {})).json();
    expect(sinPunto).toMatchObject({
      activa: false,
      mensaje: expect.stringContaining('punto de venta 3'),
    });
    afip.puntos.set(CUIT_COMERCIO, [3]);
    expect((await dueno.cliente.post('/api/v1/facturacion/verificar', {})).json()).toEqual({
      activa: true,
      mensaje: null,
    });
  });
});

describe('facturas', () => {
  it('cada venta cobrada sale con factura C; al anularla, nota de crédito', async () => {
    const { dueno, kioscoId, producto } = await comercio(e);
    await dueno.cliente.post('/api/v1/facturacion/config', datos);
    const venta = await vender(dueno, producto);
    expect(await comprobantes(e, venta)).toMatchObject([
      { tipo: 'factura_c', estado: 'pendiente', prueba: true },
    ]);
    expect(await procesarCola(e, kioscoId, enPrueba)).toMatchObject([{ estado: 'autorizado' }]);
    const [factura] = await comprobantes(e, venta);
    expect(factura).toMatchObject({
      estado: 'autorizado',
      numero: 1,
      cae: expect.stringMatching(/^\d{14}$/),
    });

    // En Ventas se ve la factura.
    const detalle = (await dueno.cliente.get(`/api/v1/ventas/${venta}`)).json<{
      comprobantes: unknown[];
    }>();
    expect(detalle.comprobantes).toMatchObject([
      { tipo: 'factura_c', numero: 1, estado: 'autorizado' },
    ]);

    await dueno.cliente.post(`/api/v1/ventas/${venta}/anular`, { motivo: 'Se equivocó' });
    await procesarCola(e, kioscoId, enPrueba);
    expect(await comprobantes(e, venta)).toMatchObject([
      { tipo: 'factura_c', estado: 'autorizado' },
      { tipo: 'nota_credito_c', estado: 'autorizado', numero: 1, anula_id: factura!.id },
    ]);
  });

  it('si ARCA se cae, la venta se guarda igual y la factura sale después, sin duplicarse', async () => {
    const { dueno, kioscoId, producto } = await comercio(e);
    await dueno.cliente.post('/api/v1/facturacion/config', datos);
    afip.caido = true;
    const venta = await vender(dueno, producto);
    const [r] = await procesarCola(e, kioscoId, enPrueba);
    expect(r).toMatchObject({ estado: 'reintentar' });
    expect(await comprobantes(e, venta)).toMatchObject([
      { estado: 'pendiente', ultimo_error: expect.stringContaining('Se reintenta solo') },
    ]);
    afip.caido = false;

    // La respuesta de ARCA se pierde: el reintento la encuentra y usa ese CAE.
    const [c] = await comprobantes(e, venta);
    afip.perderRespuesta = true;
    expect(await procesarComprobante(e.base, kioscoId, c!.id, enPrueba)).toMatchObject({
      estado: 'reintentar',
    });
    expect(await procesarComprobante(e.base, kioscoId, c!.id, enPrueba)).toMatchObject({
      estado: 'autorizado',
      numero: 1,
    });
    // ARCA tiene una sola factura de ese comercio.
    const emitidas = afip.emitidos.get(`20409378472-${puntoDeVentaDePrueba(kioscoId)}-11`);
    expect(emitidas?.length).toBe(1);
  });

  it('si ARCA la rechaza, queda en palabras y se puede reintentar', async () => {
    const { dueno, kioscoId, producto } = await comercio(e);
    await dueno.cliente.post('/api/v1/facturacion/config', datos);
    const venta = await vender(dueno, producto);
    afip.rechazar = { codigo: 10015, mensaje: 'Algún dato no corresponde' };
    expect(await procesarCola(e, kioscoId, enPrueba)).toMatchObject([{ estado: 'rechazado' }]);
    const [c] = await comprobantes(e, venta);
    expect(c).toMatchObject({
      estado: 'rechazado',
      ultimo_error: expect.stringContaining('(10015)'),
    });
    expect((await dueno.cliente.get('/api/v1/facturacion')).json()).toMatchObject({
      rechazados: 1,
    });
    expect(
      (await dueno.cliente.post(`/api/v1/comprobantes/${c!.id}/reintentar`, {})).statusCode,
    ).toBe(200);
    expect(await procesarCola(e, kioscoId, enPrueba)).toMatchObject([{ estado: 'autorizado' }]);
  });

  it('una venta de hace más de 5 días no se factura con otra fecha', async () => {
    const { dueno, kioscoId, producto } = await comercio(e);
    await dueno.cliente.post('/api/v1/facturacion/config', datos);
    const venta = await vender(dueno, producto, new Date(Date.now() - 6 * 86_400_000));
    expect(await procesarCola(e, kioscoId, enPrueba)).toMatchObject([
      { estado: 'rechazado', motivo: expect.stringContaining('más de 5 días') },
    ]);
    expect(await comprobantes(e, venta)).toMatchObject([{ estado: 'rechazado', numero: null }]);
  });

  it('en pausa no se generan facturas; al dejar de facturar se cancela lo pendiente', async () => {
    const { dueno, kioscoId, producto } = await comercio(e);
    await dueno.cliente.post('/api/v1/facturacion/config', datos);
    await dueno.cliente.post('/api/v1/facturacion/estado', { estado: 'pausada' });
    const enPausa = await vender(dueno, producto);
    expect(await comprobantes(e, enPausa)).toEqual([]);
    await dueno.cliente.post('/api/v1/facturacion/estado', { estado: 'activa' });
    const otra = await vender(dueno, producto);
    expect(await comprobantes(e, otra)).toMatchObject([{ estado: 'pendiente' }]);
    await dueno.cliente.post('/api/v1/facturacion/estado', { estado: 'baja' });
    expect(await comprobantes(e, otra)).toMatchObject([{ estado: 'cancelado' }]);
    expect(await procesarCola(e, kioscoId, enPrueba)).toMatchObject([{ estado: 'omitido' }]);
  });

  it('el encargado ve el estado pero no configura', async () => {
    const { kioscoId } = await comercio(e);
    const enc = await altaConInvitacion(e.app, e.admin, kioscoId, 'encargado');
    expect((await enc.cliente.get('/api/v1/facturacion')).statusCode).toBe(200);
    expect((await enc.cliente.post('/api/v1/facturacion/config', datos)).statusCode).toBe(403);
    expect(
      (await enc.cliente.put('/api/v1/facturacion/modulo', { activo: false })).statusCode,
    ).toBe(403);
  });
});
