// Mostrador de ferretería: unidad, ubicación, lista de gremio y cantidades con decimales
// (etapa I2, docs/decisiones/009-rubros.md).
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let kiosco: string;

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
});
afterAll(async () => {
  await e.cerrar();
});

async function cable(codigo = `ELE-${uuidv7().slice(-6)}`) {
  const r = await dueno.cliente.post('/api/v1/productos', {
    nombre: 'Cable unipolar 2,5 mm² rojo',
    precio: 145000,
    precioGremio: 123000,
    unidad: 'metro',
    ubicacion: 'Pasillo 3 · B',
    stockInicial: 184,
    codigos: [codigo],
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ id: string }>().id;
}

describe('productos de ferretería', () => {
  it('guardan unidad, ubicación y precio de gremio, y viajan en el catálogo', async () => {
    const id = await cable();
    const p = (await dueno.cliente.get(`/api/v1/productos/${id}`)).json();
    expect(p).toMatchObject({
      unidad: 'metro',
      ubicacion: 'Pasillo 3 · B',
      precioGremio: 123000,
      stock: 184,
    });
    const cat = (await dueno.cliente.get('/api/v1/catalogo')).json<{
      productos: { id: string; unidad: string; ubicacion: string; precioGremio: number }[];
    }>();
    expect(cat.productos.find((x) => x.id === id)).toMatchObject({
      unidad: 'metro',
      ubicacion: 'Pasillo 3 · B',
      precioGremio: 123000,
    });
    const r = await dueno.cliente.patch(`/api/v1/productos/${id}`, {
      unidad: 'kilo',
      ubicacion: null,
      precioGremio: null,
    });
    expect(r.statusCode).toBe(200);
    expect((await dueno.cliente.get(`/api/v1/productos/${id}`)).json()).toMatchObject({
      unidad: 'kilo',
      ubicacion: null,
      precioGremio: null,
    });
  });

  it('rechaza unidades que no existen', async () => {
    const r = await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Algo',
      precio: 100,
      unidad: 'pulgada',
    });
    expect(r.statusCode).toBe(400);
  });

  it('se venden con decimales y con la lista de gremio; el stock baja lo vendido', async () => {
    const id = await cable();
    const turnoId = uuidv7();
    const ventaId = uuidv7();
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    const r = await cajero.post('/api/v1/sync', {
      ops: [
        {
          tipo: 'apertura',
          datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
        },
        {
          tipo: 'venta',
          datos: {
            id: ventaId,
            turnoId,
            creadaEn: new Date().toISOString(),
            lista: 'gremio',
            total: 1537500,
            items: [
              {
                id: uuidv7(),
                productoId: id,
                descripcion: 'Cable unipolar 2,5 mm² rojo',
                cantidad: 12.5,
                precioUnitario: 123000,
              },
            ],
            pagos: [{ id: uuidv7(), medio: 'efectivo', monto: 1537500, recibido: 1600000 }],
          },
        },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().resultados[1]).toMatchObject({ estado: 'ok' });
    const v = await e.admin.query<{ lista: string; cantidad: string; stock: string }>(
      `select v.lista, i.cantidad, p.stock_actual as stock
       from ventas v join venta_items i on i.venta_id = v.id join productos p on p.id = i.producto_id
       where v.id = $1`,
      [ventaId],
    );
    expect(v.rows[0]).toEqual({ lista: 'gremio', cantidad: '12.500', stock: '171.500' });
  });

  it('el CSV acepta unidad, ubicación y precio de gremio', async () => {
    const csv = [
      'nombre;precio;codigo;unidad;ubicacion;gremio',
      'Cadena 3 mm;$ 2.100;FER-0001;m;Pared del fondo;1.800',
      // Así lo guarda Excel: las comillas del texto van dobladas.
      '"Clavo punta París 2""";6500;FER-0002;kg;Pasillo 1 · A;',
      'Tarugo 8 mm x 100;5200;FER-0003;caja;;',
      'Otra cosa;100;FER-0004;pulgada;;',
    ].join('\n');
    const r = await dueno.cliente.post('/api/v1/productos/importar', { csv });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json(), r.body).toMatchObject({ creados: 3, errores: [{ linea: 5 }] });
    const { rows } = await e.admin.query(
      `select p.nombre, p.unidad, p.ubicacion, p.precio_gremio from productos p
       join codigos_barra c on c.producto_id = p.id
       where p.kiosco_id = $1 and c.codigo like 'FER-%' order by c.codigo`,
      [kiosco],
    );
    expect(rows).toEqual([
      {
        nombre: 'Cadena 3 mm',
        unidad: 'metro',
        ubicacion: 'Pared del fondo',
        precio_gremio: 180000,
      },
      {
        nombre: 'Clavo punta París 2"',
        unidad: 'kilo',
        ubicacion: 'Pasillo 1 · A',
        precio_gremio: null,
      },
      { nombre: 'Tarugo 8 mm x 100', unidad: 'caja', ubicacion: null, precio_gremio: null },
    ]);
  });
});
