// Actualizar precios con la lista del proveedor en Excel (etapa I3).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { uuidv7 } from '../../../packages/shared/src/uuid.ts';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

// Planilla .xlsx real (zip con deflate): título, fila vacía, encabezado y tres renglones.
const LISTA_XLSX =
  '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';

test('se sube la lista en Excel, se revisa, se aplica, se imprimen etiquetas y se deshace', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pc', 'Se hace en la PC del mostrador');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['precios_proveedor', 'listas_precios']);
  await productos(d.kioscoId, [
    {
      nombre: 'Cable unipolar 2,5 mm² rojo',
      precio: 145000,
      precioGremio: 123000,
      codigo: 'ELE-0125',
    },
    { nombre: 'Llave de luz armada', precio: 390000, codigo: '7791234567893' },
  ]);
  const c = admin();
  await c.query(
    `update productos set costo = 98000 where kiosco_id = $1 and nombre like 'Cable%'`,
    [d.kioscoId],
  );
  await c.query(
    `update productos set costo = 260000 where kiosco_id = $1 and nombre like 'Llave%'`,
    [d.kioscoId],
  );
  const proveedor = uuidv7();
  await c.query(
    `insert into proveedores (id, kiosco_id, nombre) values ($1, $2, 'Distribuidora Sur')`,
    [proveedor, d.kioscoId],
  );
  await c.query(
    `insert into producto_proveedor (id, kiosco_id, producto_id, proveedor_id, codigo)
     select $1, $2, id, $3, 'SUR-11872' from productos where kiosco_id = $2 and nombre like 'Cable%'`,
    [uuidv7(), d.kioscoId, proveedor],
  );

  await entrar(page, d);
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Proveedores' }).click();
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await page.getByRole('button', { name: 'Subir lista nueva' }).click();
  await expect(
    page.getByRole('heading', { name: 'Lista nueva de Distribuidora Sur' }),
  ).toBeVisible();

  await page.getByLabel(/Elegir la lista/).setInputFiles({
    name: 'lista-sur-octubre.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(LISTA_XLSX, 'base64'),
  });
  await expect(page.getByText('3 renglones con código y precio.')).toBeVisible();
  await expect(page.getByLabel('Código', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Precio', { exact: true })).toHaveValue('2');

  await page.getByRole('button', { name: 'Ver los cambios' }).click();
  const tabla = page.getByRole('table');
  await expect(tabla.getByRole('row', { name: /Cable unipolar/ })).toContainText('$ 1.550');
  await expect(tabla.getByRole('row', { name: /Cable unipolar/ })).toContainText('$ 1.350');
  await expect(tabla.getByRole('row', { name: /Llave de luz/ })).toContainText('$ 4.150');
  await expect(page.getByText('Cinta aisladora 20 m')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  await page.getByRole('button', { name: 'Cargar todos como nuevos' }).click();
  page.on('dialog', (dialogo) => void dialogo.accept());
  await page.getByRole('button', { name: 'Aplicar: 3 productos' }).click();
  await expect(page.getByRole('heading', { name: 'Lista aplicada' })).toBeVisible();
  await expect(page.getByText('Cambiaron 2 productos y se cargó 1 nuevo.')).toBeVisible();

  // Etiquetas: se imprimen las de los precios que cambiaron y la del producto nuevo.
  await page.evaluate(() => document.documentElement.classList.add('imprimiendo-etiquetas'));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.etiqueta')).toHaveCount(3);
  await expect(page.locator('.etiqueta').first()).toContainText('$ 1.550');
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByText('Volvieron los 2 precios de antes.')).toBeVisible();
  const { rows } = await c.query(
    `select nombre, precio::int as precio from productos where kiosco_id = $1 order by nombre`,
    [d.kioscoId],
  );
  expect(rows).toEqual([
    { nombre: 'Cable unipolar 2,5 mm² rojo', precio: 145000 },
    { nombre: 'Cinta aisladora 20 m', precio: 70000 },
    { nombre: 'Llave de luz armada', precio: 390000 },
  ]);
});

test('la lista nueva recuerda el formato y los números de la anterior del proveedor', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pc', 'Se hace en la PC del mostrador');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['precios_proveedor']);
  const c = admin();
  const proveedor = uuidv7();
  await c.query(
    `insert into proveedores (id, kiosco_id, nombre) values ($1, $2, 'Distribuidora Sur')`,
    [proveedor, d.kioscoId],
  );
  // La vez pasada: 12 % de bonificación, sin IVA, y el precio estaba en la columna B.
  await c.query(
    `insert into listas_proveedor (id, kiosco_id, proveedor_id, usuario_id, archivo, renglones, opciones, detalle)
     select $1, $2, $3, usuario_id, 'lista-septiembre.xlsx', 3, $4, '[]'
       from membresias where kiosco_id = $2`,
    [
      uuidv7(),
      d.kioscoId,
      proveedor,
      JSON.stringify({
        descuento: 12,
        iva: true,
        calculo: 'ganancia',
        ganancia: 55,
        redondeo: 1000,
        gremio: 'no',
        gananciaGremio: 25,
        columnas: { encabezado: 2, codigo: 0, descripcion: -1, precio: 1 },
      }),
    ],
  );

  await entrar(page, d);
  await page.goto(`/stock/proveedores/${proveedor}/lista`);
  await expect(page.getByRole('heading', { name: /Lista nueva/ })).toBeVisible();
  await page.getByLabel(/Elegir la lista/).setInputFiles({
    name: 'lista-sur-octubre.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(LISTA_XLSX, 'base64'),
  });
  await expect(page.getByLabel('Precio', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Bonificación del proveedor (%)')).toHaveValue('12');
  await expect(page.getByLabel('La lista viene sin IVA: sumar 21 %')).toBeChecked();
  await expect(page.getByLabel('Ganancia (%)')).toHaveValue('55');
});
