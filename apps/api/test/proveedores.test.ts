// Proveedores y actualización de precios con su lista (etapa I3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  crearEntorno,
  activarModulos,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let kiosco: string;
let proveedor: string;
const ids: Record<string, string> = {};

const OPCIONES = {
  descuento: 0,
  iva: false,
  calculo: 'mantener',
  ganancia: 50,
  redondeo: 5000,
  gremio: 'mantener',
  gananciaGremio: 22,
} as const;

const LISTA = [
  { codigo: 'SUR-11872', descripcion: 'Cable unipolar 2,5 mm² rojo', costo: 106000 },
  { codigo: '7791234567893', descripcion: 'Llave de luz armada', costo: 278000 },
  { codigo: 'SUR-30155', descripcion: 'Caño termofusión 20 mm', costo: 295000 },
  { codigo: 'SUR-77777', descripcion: 'Cinta aisladora 20 m', costo: 50000 },
  { codigo: 'sur-11872', descripcion: 'Repetido en la lista', costo: 1 },
];

async function producto(datos: Record<string, unknown>) {
  const r = await dueno.cliente.post('/api/v1/productos', datos);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ id: string }>().id;
}

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  await activarModulos(e.admin, kiosco, ['precios_proveedor']);
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
  proveedor = (
    await dueno.cliente.post('/api/v1/proveedores', { nombre: 'Distribuidora Sur' })
  ).json<{
    id: string;
  }>().id;
  ids.cable = await producto({
    nombre: 'Cable unipolar 2,5 mm² rojo',
    precio: 145000,
    costo: 98000,
    precioGremio: 123000,
    proveedores: [{ proveedorId: proveedor, codigo: 'SUR-11872' }],
  });
  ids.llave = await producto({
    nombre: 'Llave de luz armada',
    precio: 390000,
    costo: 260000,
    codigos: ['7791234567893'],
  });
  ids.cano = await producto({ nombre: 'Caño PPF 20', precio: 390000, costo: 270000 });
});
afterAll(async () => {
  await e.cerrar();
});

describe('proveedores', () => {
  it('no repite nombres y el producto guarda el código del proveedor', async () => {
    const r = await dueno.cliente.post('/api/v1/proveedores', { nombre: 'distribuidora sur' });
    expect(r.statusCode).toBe(409);
    const p = (await dueno.cliente.get(`/api/v1/productos/${ids.cable}`)).json();
    expect(p.proveedores).toEqual([
      expect.objectContaining({
        proveedorId: proveedor,
        nombre: 'Distribuidora Sur',
        codigo: 'SUR-11872',
      }),
    ]);
    const lista = (await dueno.cliente.get('/api/v1/proveedores')).json();
    expect(lista).toEqual([expect.objectContaining({ nombre: 'Distribuidora Sur', productos: 1 })]);
  });

  it('la vista previa cruza por código del proveedor, de barras o a mano y mantiene la ganancia', async () => {
    const r = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
      renglones: LISTA,
      opciones: OPCIONES,
      vincular: [{ codigo: 'SUR-30155', productoId: ids.cano }],
    });
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json();
    expect(v.resumen).toMatchObject({
      renglones: 5,
      encontrados: 3,
      suben: 3,
      bajan: 0,
      nuevos: 1,
      repetidos: 1,
    });
    const porCodigo = Object.fromEntries(v.cambios.map((c: { codigo: string }) => [c.codigo, c]));
    // 145.000 × 106.000 / 98.000 = 156.837 → redondeado a $ 50: 155.000.
    expect(porCodigo['SUR-11872']).toMatchObject({
      vinculo: 'proveedor',
      costoAntes: 98000,
      costo: 106000,
      precio: 155000,
      gremio: 135000,
      variacion: 8.2,
    });
    expect(porCodigo['7791234567893']).toMatchObject({
      vinculo: 'barras',
      precio: 415000,
      gremio: null,
    });
    expect(porCodigo['SUR-30155']).toMatchObject({ vinculo: 'manual', precio: 425000 });
    expect(v.nuevos).toEqual([
      { codigo: 'SUR-77777', descripcion: 'Cinta aisladora 20 m', costo: 50000, precio: 75000 },
    ]);
  });

  it('descuenta la bonificación y suma el IVA al costo', async () => {
    const r = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
      renglones: [{ codigo: 'SUR-11872', descripcion: '', costo: 100000 }],
      opciones: { ...OPCIONES, descuento: 10, iva: true, calculo: 'ganancia', ganancia: 40 },
    });
    // 100.000 − 10 % = 90.000; + 21 % = 108.900; + 40 % = 152.460 → $ 1.500.
    expect(r.json().cambios[0]).toMatchObject({ costo: 108900, precio: 150000 });
  });

  it('el redondeo nunca deja un precio en $ 0 ni por debajo del costo', async () => {
    const r = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
      renglones: [
        { codigo: 'BARATO-1', descripcion: 'Arandela', costo: 1000 },
        { codigo: 'BARATO-2', descripcion: 'Tornillo', costo: 6000 },
      ],
      opciones: { ...OPCIONES, calculo: 'ganancia', ganancia: 10 },
    });
    const nuevos = Object.fromEntries(
      r.json().nuevos.map((n: { codigo: string; precio: number }) => [n.codigo, n.precio]),
    );
    // $ 10 + 10 % = $ 11 → $ 50 (no $ 0). $ 60 + 10 % = $ 66 → $ 100 (no $ 50, debajo del costo).
    expect(nuevos).toMatchObject({ 'BARATO-1': 5000, 'BARATO-2': 10000 });
  });

  it('sin la función activada o con el plan Esencial, no se actualizan precios con listas', async () => {
    const pedir = () =>
      dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
        renglones: LISTA,
        opciones: OPCIONES,
      });
    await e.admin.query(`update kioscos set plan = 'esencial' where id = $1`, [kiosco]);
    expect((await pedir()).statusCode).toBe(403);
    await e.admin.query(`update kioscos set plan = 'comercio', modulos = '{}' where id = $1`, [
      kiosco,
    ]);
    expect((await pedir()).statusCode).toBe(403);
    await activarModulos(e.admin, kiosco, ['precios_proveedor']);
    expect((await pedir()).statusCode).toBe(200);
  });

  it('aplica en una transacción, guarda los códigos, crea los nuevos y se puede deshacer', async () => {
    const r = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/aplicar`, {
      archivo: 'lista-sur-octubre.xlsx',
      renglones: LISTA,
      opciones: OPCIONES,
      vincular: [{ codigo: 'SUR-30155', productoId: ids.cano }],
      crear: ['SUR-77777'],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ cambiados: 3, creados: 1 });
    const listaId = r.json<{ id: string }>().id;

    const cable = (await dueno.cliente.get(`/api/v1/productos/${ids.cable}`)).json();
    expect(cable).toMatchObject({ precio: 155000, costo: 106000, precioGremio: 135000 });
    const { rows: vinculos } = await e.admin.query(
      `select codigo from producto_proveedor where kiosco_id = $1 order by codigo`,
      [kiosco],
    );
    expect(vinculos.map((v) => v.codigo)).toEqual([
      '7791234567893',
      'SUR-11872',
      'SUR-30155',
      'SUR-77777',
    ]);
    const { rows: auditoria } = await e.admin.query(
      `select detalle from auditoria where kiosco_id = $1 and accion = 'precios.proveedor'`,
      [kiosco],
    );
    expect(auditoria[0].detalle).toMatchObject({ cambiados: 3, creados: 1 });

    // La misma lista otra vez: encuentra todo por código del proveedor y no cambia nada.
    const otra = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
      renglones: LISTA,
      opciones: OPCIONES,
    });
    expect(otra.json().resumen).toMatchObject({ encontrados: 4, cambian: 0, nuevos: 0 });
    const igual = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/aplicar`, {
      renglones: LISTA,
      opciones: OPCIONES,
    });
    expect(igual.statusCode).toBe(400);

    // Deshacer: vuelve todo, salvo lo que se tocó después.
    await dueno.cliente.patch(`/api/v1/productos/${ids.cano}`, { precio: 430000 });
    const d = await dueno.cliente.post(`/api/v1/listas-proveedor/${listaId}/deshacer`, {});
    expect(d.json()).toEqual({ restaurados: 2, saltados: 1 });
    expect((await dueno.cliente.get(`/api/v1/productos/${ids.cable}`)).json()).toMatchObject({
      precio: 145000,
      costo: 98000,
      precioGremio: 123000,
    });
    const otraVez = await dueno.cliente.post(`/api/v1/listas-proveedor/${listaId}/deshacer`, {});
    expect(otraVez.statusCode).toBe(409);
    const historial = (await dueno.cliente.get(`/api/v1/proveedores/${proveedor}/listas`)).json();
    expect(historial[0]).toMatchObject({ archivo: 'lista-sur-octubre.xlsx', productos: 4 });
  });

  it('el encargado carga proveedores pero no actualiza precios en masa', async () => {
    const encargado = await altaConInvitacion(e.app, e.admin, kiosco, 'encargado');
    expect(
      (await encargado.cliente.post('/api/v1/proveedores', { nombre: 'Corralón Norte' }))
        .statusCode,
    ).toBe(200);
    const r = await encargado.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
      renglones: LISTA,
      opciones: OPCIONES,
    });
    expect(r.statusCode).toBe(403);
  });

  it('rechaza opciones fuera de rango y campos de más', async () => {
    for (const opciones of [
      { ...OPCIONES, descuento: 95 },
      { ...OPCIONES, redondeo: 7 },
      { ...OPCIONES, extra: 1 },
    ]) {
      const r = await dueno.cliente.post(`/api/v1/proveedores/${proveedor}/lista/vista-previa`, {
        renglones: LISTA,
        opciones,
      });
      expect(r.statusCode).toBe(400);
    }
  });
});
