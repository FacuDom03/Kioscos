// Compras como factura de compra: proveedor, comprobante, fecha y renglones que suman stock o no.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

async function comercio() {
  const dueno = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
  const crear = async (nombre: string, stockInicial: number) =>
    (await dueno.cliente.post('/api/v1/productos', { nombre, precio: 200000, stockInicial })).json<{
      id: string;
    }>().id;
  const yerba = await crear('Yerba 1 kg', 5);
  const azucar = await crear('Azúcar 1 kg', 5);
  const proveedor = (
    await dueno.cliente.post('/api/v1/proveedores', { nombre: 'Distribuidora Sur' })
  ).json<{ id: string }>().id;
  return { dueno, yerba, azucar, proveedor };
}

const stock = async (dueno: Persona, id: string) =>
  (await dueno.cliente.get('/api/v1/productos'))
    .json<{ productos: { id: string; stock: number; costo: number | null }[] }>()
    .productos.find((p) => p.id === id);

describe('factura de compra', () => {
  it('guarda proveedor, comprobante y fecha; solo suma stock lo que corresponde', async () => {
    const { dueno, yerba, azucar, proveedor } = await comercio();
    const r = await dueno.cliente.post('/api/v1/compras', {
      proveedorId: proveedor,
      comprobante: 'factura_a',
      numero: '3-1234',
      fecha: '2026-10-01',
      items: [
        { productoId: yerba, cantidad: 10, costoUnitario: 150000 },
        // La azúcar ya había entrado con el remito: no suma stock, pero el costo se actualiza.
        { productoId: azucar, cantidad: 4, costoUnitario: 90000, sumaStock: false },
        { descripcion: 'Flete', cantidad: 1, costoUnitario: 500000 },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    const { id } = r.json<{ id: string }>();

    expect(await stock(dueno, yerba)).toMatchObject({ stock: 15, costo: 150000 });
    expect(await stock(dueno, azucar)).toMatchObject({ stock: 5, costo: 90000 });

    const detalle = (await dueno.cliente.get(`/api/v1/compras/${id}`)).json();
    expect(detalle).toMatchObject({
      total: 1500000 + 360000 + 500000,
      proveedor: 'Distribuidora Sur',
      comprobante: 'factura_a',
      numero: '00003-00001234',
      fecha: '2026-10-01',
      items: [
        { nombre: 'Yerba 1 kg', suma_stock: true, cantidad: 10 },
        { nombre: 'Azúcar 1 kg', suma_stock: false, cantidad: 4 },
        { nombre: null, descripcion: 'Flete', suma_stock: false, subtotal: 500000 },
      ],
    });
    const lista = (await dueno.cliente.get('/api/v1/compras')).json();
    expect(lista).toMatchObject([
      { id, proveedor: 'Distribuidora Sur', comprobante: 'factura_a', numero: '00003-00001234' },
    ]);
  });

  it('la misma factura del mismo proveedor no se carga dos veces', async () => {
    const { dueno, yerba, proveedor } = await comercio();
    const factura = {
      proveedorId: proveedor,
      comprobante: 'factura_b',
      numero: '0003-00000077',
      items: [{ productoId: yerba, cantidad: 2, costoUnitario: 100000 }],
    };
    expect((await dueno.cliente.post('/api/v1/compras', factura)).statusCode).toBe(200);
    const otra = await dueno.cliente.post('/api/v1/compras', { ...factura, numero: '3-77' });
    expect(otra.statusCode).toBe(409);
    expect(otra.json<{ error: string }>().error).toContain('ya está cargada');
    expect(await stock(dueno, yerba)).toMatchObject({ stock: 7 });
    // Otro tipo de comprobante con el mismo número sí se puede.
    const remito = await dueno.cliente.post('/api/v1/compras', {
      ...factura,
      comprobante: 'remito',
    });
    expect(remito.statusCode).toBe(200);
  });

  it('rechaza con palabras los datos que no cierran', async () => {
    const { dueno, yerba } = await comercio();
    const item = { productoId: yerba, cantidad: 1, costoUnitario: 100 };
    const mal = async (cuerpo: object) => {
      const r = await dueno.cliente.post('/api/v1/compras', cuerpo);
      expect(r.statusCode, JSON.stringify(cuerpo)).toBe(400);
      return r.json<{ error: string }>().error;
    };
    expect(await mal({ comprobante: 'factura_a', numero: '1234', items: [item] })).toContain(
      '0003-00001234',
    );
    expect(await mal({ numero: '3-1', items: [item] })).toContain('tipo de comprobante');
    expect(await mal({ fecha: '2099-01-01', items: [item] })).toContain('futura');
    // Un renglón es un producto o una descripción, no las dos cosas ni ninguna.
    await mal({ items: [{ ...item, descripcion: 'Yerba' }] });
    await mal({ items: [{ cantidad: 1, costoUnitario: 100 }] });
    // Sin producto no hay precio que cambiar.
    await mal({ items: [{ descripcion: 'Flete', cantidad: 1, costoUnitario: 100, margen: 30 }] });
    // Un ticket puede tener cualquier número.
    expect(
      (
        await dueno.cliente.post('/api/v1/compras', {
          comprobante: 'ticket',
          numero: 'T-889',
          items: [item],
        })
      ).statusCode,
    ).toBe(200);
  });
});
