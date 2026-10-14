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

beforeAll(async () => {
  e = await crearEntorno();
  dueno = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
});
afterAll(async () => {
  await e.cerrar();
});

async function crearProducto(datos: Record<string, unknown>) {
  const r = await dueno.cliente.post('/api/v1/productos', datos);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ id: string }>().id;
}

describe('productos', () => {
  it('alta con código, categoría y stock inicial', async () => {
    const cat = (await dueno.cliente.post('/api/v1/categorias', { nombre: 'Bebidas' })).json<{
      id: string;
    }>().id;
    const id = await crearProducto({
      nombre: 'Coca-Cola 500 ml',
      precio: 180000,
      costo: 120000,
      categoriaId: cat,
      minimo: 6,
      stockInicial: 12,
      codigos: ['7790895000997'],
    });
    const p = (await dueno.cliente.get(`/api/v1/productos/${id}`)).json();
    expect(p).toMatchObject({
      nombre: 'Coca-Cola 500 ml',
      precio: 180000,
      costo: 120000,
      stock: 12,
      minimo: 6,
      codigos: ['7790895000997'],
    });
    expect(p.movimientos[0]).toMatchObject({
      tipo: 'ajuste',
      cantidad: 12,
      motivo: 'Stock inicial',
    });
  });

  it('un código de barras no se repite en el kiosco', async () => {
    await crearProducto({ nombre: 'Agua', precio: 90000, codigos: ['7798062540017'] });
    const r = await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Otra agua',
      precio: 90000,
      codigos: ['7798062540017'],
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('codigo_repetido');
  });

  it('el mismo código puede estar en otro kiosco', async () => {
    const otro = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
    const r = await otro.cliente.post('/api/v1/productos', {
      nombre: 'Agua',
      precio: 1,
      codigos: ['7798062540017'],
    });
    expect(r.statusCode).toBe(200);
  });

  it('editar cambia datos y reemplaza los códigos', async () => {
    const id = await crearProducto({ nombre: 'Chicle', precio: 30000, codigos: ['111111'] });
    expect(
      (await dueno.cliente.patch(`/api/v1/productos/${id}`, { precio: 35000, codigos: ['222222'] }))
        .statusCode,
    ).toBe(200);
    const p = (await dueno.cliente.get(`/api/v1/productos/${id}`)).json();
    expect(p).toMatchObject({ precio: 35000, codigos: ['222222'] });
  });

  it('el catálogo para el cajero no trae costos', async () => {
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    const cat = (await cajero.get('/api/v1/catalogo')).json<{
      productos: Record<string, unknown>[];
    }>();
    expect(cat.productos.length).toBeGreaterThan(0);
    for (const p of cat.productos) expect(p).not.toHaveProperty('costo');
    expect((await cajero.post('/api/v1/productos', { nombre: 'X', precio: 1 })).statusCode).toBe(
      403,
    );
    const delDueno = (await dueno.cliente.get('/api/v1/catalogo')).json<{
      productos: Record<string, unknown>[];
    }>();
    expect(delDueno.productos.some((p) => 'costo' in p)).toBe(true);
  });
});

describe('stock', () => {
  it('por reponer: stock igual o menor al mínimo', async () => {
    const id = await crearProducto({
      nombre: 'Alfajor por reponer',
      precio: 100000,
      minimo: 10,
      stockInicial: 3,
    });
    const r = (await dueno.cliente.get('/api/v1/productos?filtro=por_reponer')).json<{
      productos: { id: string }[];
      conteo: { porReponer: number };
    }>();
    expect(r.productos.map((p) => p.id)).toContain(id);
    expect(r.conteo.porReponer).toBeGreaterThan(0);
  });

  it('ajuste por conteo deja el stock en lo contado', async () => {
    const id = await crearProducto({ nombre: 'Galletitas', precio: 100000, stockInicial: 10 });
    const r = await dueno.cliente.post('/api/v1/stock/ajustes', {
      productoId: id,
      motivo: 'conteo',
      contado: 7,
    });
    expect(r.json()).toEqual({ stock: 7 });
    const p = (await dueno.cliente.get(`/api/v1/productos/${id}`)).json();
    expect(p.movimientos[0]).toMatchObject({ tipo: 'ajuste', cantidad: -3, motivo: 'Conteo' });
  });

  it('la compra suma stock, guarda el costo y puede actualizar el precio con margen', async () => {
    const id = await crearProducto({
      nombre: 'Yerba',
      precio: 300000,
      costo: 200000,
      stockInicial: 2,
    });
    const r = await dueno.cliente.post('/api/v1/compras', {
      items: [{ productoId: id, cantidad: 10, costoUnitario: 250000, margen: 40 }],
    });
    expect(r.statusCode, r.body).toBe(200);
    const p = (await dueno.cliente.get(`/api/v1/productos/${id}`)).json();
    expect(p).toMatchObject({ stock: 12, costo: 250000, precio: 350000 });
    const compras = (await dueno.cliente.get('/api/v1/compras')).json<{ total: number }[]>();
    expect(compras[0]!.total).toBe(2500000);
  });

  it('una compra con un producto inexistente no deja nada a medias', async () => {
    const id = await crearProducto({ nombre: 'Fideos', precio: 100000, stockInicial: 1 });
    const r = await dueno.cliente.post('/api/v1/compras', {
      items: [
        { productoId: id, cantidad: 5, costoUnitario: 1000 },
        { productoId: '0192a000-0000-7000-8000-0000000000ee', cantidad: 1, costoUnitario: 1 },
      ],
    });
    expect(r.statusCode).toBe(404);
    expect((await dueno.cliente.get(`/api/v1/productos/${id}`)).json().stock).toBe(1);
  });
});

describe('aumento masivo', () => {
  it('vista previa, aplicar y deshacer (sin pisar cambios posteriores)', async () => {
    const cat = (await dueno.cliente.post('/api/v1/categorias', { nombre: 'Golosinas' })).json<{
      id: string;
    }>().id;
    const a = await crearProducto({ nombre: 'Caramelo A', precio: 10000, categoriaId: cat });
    const b = await crearProducto({ nombre: 'Caramelo B', precio: 123400, categoriaId: cat });
    const datos = { alcance: 'categoria', categoriaId: cat, porcentaje: 10, redondeo: 5000 };

    const vista = (await dueno.cliente.post('/api/v1/precios/vista-previa', datos)).json<{
      cambios: { producto_id: string; antes: number; despues: number }[];
    }>();
    expect(vista.cambios).toEqual([
      { producto_id: a, nombre: 'Caramelo A', antes: 10000, despues: 10000 },
      { producto_id: b, nombre: 'Caramelo B', antes: 123400, despues: 135000 },
    ]);
    // La vista previa no cambia nada.
    expect((await dueno.cliente.get(`/api/v1/productos/${b}`)).json().precio).toBe(123400);

    const r = (await dueno.cliente.post('/api/v1/precios/aumentos', datos)).json<{
      id: string;
      productos: number;
    }>();
    expect(r.productos).toBe(1);
    expect((await dueno.cliente.get(`/api/v1/productos/${b}`)).json().precio).toBe(135000);

    const d = await dueno.cliente.post(`/api/v1/precios/aumentos/${r.id}/deshacer`);
    expect(d.json()).toEqual({ restaurados: 1, saltados: 0 });
    expect((await dueno.cliente.get(`/api/v1/productos/${b}`)).json().precio).toBe(123400);
    expect((await dueno.cliente.post(`/api/v1/precios/aumentos/${r.id}/deshacer`)).statusCode).toBe(
      409,
    );

    // Si alguien cambió el precio después del aumento, deshacer no lo pisa.
    const r2 = (await dueno.cliente.post('/api/v1/precios/aumentos', datos)).json<{ id: string }>();
    await dueno.cliente.patch(`/api/v1/productos/${b}`, { precio: 999900 });
    expect((await dueno.cliente.post(`/api/v1/precios/aumentos/${r2.id}/deshacer`)).json()).toEqual(
      { restaurados: 0, saltados: 1 },
    );
    expect((await dueno.cliente.get(`/api/v1/productos/${b}`)).json().precio).toBe(999900);

    const audit = (await dueno.cliente.get('/api/v1/auditoria')).json<{ accion: string }[]>();
    expect(audit.map((x) => x.accion)).toEqual(
      expect.arrayContaining(['precios.aumento', 'precios.deshacer']),
    );
  });

  it('el encargado no puede hacer aumentos masivos', async () => {
    const enc = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin), 'encargado');
    // El encargado entra al kiosco donde lo invitaron, que no tiene dueño todavía: alcanza para probar permisos.
    const r = await enc.cliente.post('/api/v1/precios/vista-previa', {
      alcance: 'todo',
      porcentaje: 10,
      redondeo: 1000,
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('importar CSV', () => {
  it('carga 200 productos y actualiza por código', async () => {
    const kiosco = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
    const filas = ['nombre;precio;codigo;categoria;costo;stock;minimo'];
    for (let i = 0; i < 200; i++)
      filas.push(
        `Producto ${i};${1000 + i},50;779${String(i).padStart(10, '0')};${i % 2 ? 'Bebidas' : 'Almacén'};800;5;2`,
      );
    filas.push('Sin precio;;;;;;');
    const r = await kiosco.cliente.post('/api/v1/productos/importar', { csv: filas.join('\n') });
    expect(r.json()).toEqual({
      creados: 200,
      actualizados: 0,
      errores: [{ linea: 202, motivo: 'Precio inválido' }],
    });
    const cat = (await kiosco.cliente.get('/api/v1/catalogo')).json<{
      productos: { nombre: string; precio: number; stock: number }[];
      categorias: unknown[];
    }>();
    expect(cat.productos).toHaveLength(200);
    expect(cat.categorias).toHaveLength(2);
    expect(cat.productos.find((p) => p.nombre === 'Producto 5')).toMatchObject({
      precio: 100550,
      stock: 5,
    });

    const r2 = await kiosco.cliente.post('/api/v1/productos/importar', {
      csv: 'nombre,precio,codigo\nProducto 5 nuevo,2000,7790000000005',
    });
    expect(r2.json()).toMatchObject({ creados: 0, actualizados: 1 });
  });

  it('rechaza un archivo sin las columnas obligatorias', async () => {
    const r = await dueno.cliente.post('/api/v1/productos/importar', {
      csv: 'producto;valor\nA;1',
    });
    expect(r.statusCode).toBe(400);
  });
});
