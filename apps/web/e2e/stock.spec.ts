import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

test('alta de producto, Por reponer, compra y aumento con deshacer', async ({ page }, info) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByLabel('Nombre').fill('Alfajor triple');
  await page.getByLabel('Precio de venta').fill('1.200');
  await page.getByLabel('Costo (opcional)').fill('700');
  await page.getByLabel('Stock mínimo').fill('10');
  await page.getByLabel('Stock actual').fill('3');
  await page.getByLabel('Código nuevo').fill('7790040000001');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();
  await expect(page.getByText('Alfajor triple')).toBeVisible();
  await expect(page.getByText('Quedan 3')).toBeVisible();
  await page.getByRole('button', { name: /Por reponer \(1\)/ }).click();
  await expect(page.getByText('Alfajor triple')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mandar la lista por WhatsApp' })).toHaveAttribute(
    'href',
    /Alfajor%20triple%20\(quedan%203%2C%20m%C3%ADnimo%2010\)/,
  );

  // Cargar compra: llegan 24 a $ 800 con 50 % de margen.
  await page.getByRole('button', { name: 'Cargar compra' }).click();
  await page.getByLabel('Agregar producto').fill('7790040000001');
  await page.getByLabel('Agregar producto').press('Enter');
  await page.getByLabel('Cantidad').fill('24');
  await page.getByLabel('Costo por unidad').fill('800');
  await page.getByLabel(/Margen/).fill('50');
  await expect(page.getByText('$ 19.200')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar compra' }).click();
  await expect(page.getByText('27 en stock')).toBeVisible();
  await expect(page.getByText('$ 1.200').first()).toBeVisible();

  // Aumento masivo con vista previa y deshacer.
  await page.getByRole('button', { name: 'Aumentar precios' }).click();
  await page.getByLabel('Porcentaje de aumento').fill('10');
  await page.getByLabel('Redondear al').selectOption('5000');
  await page.getByRole('button', { name: 'Ver cómo quedan' }).click();
  await expect(
    page.getByRole('heading', { name: 'Vista previa: cambian 1 precios' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '$ 1.200' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '$ 1.300' })).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar aumento' }).click();
  await expect(page.getByText(/cambiaron 1 precios/)).toBeVisible();
  page.once('dialog', (dlg) => void dlg.accept());
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByText('Volvieron 1 precios a como estaban.')).toBeVisible();
  void info;
});

test('importar 200 productos desde un CSV', async ({ page }) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/stock/importar');
  const filas = ['nombre;precio;codigo;categoria'];
  for (let i = 0; i < 200; i++)
    filas.push(
      `Producto ${i};${1000 + i};779${String(i).padStart(10, '0')};${i % 2 ? 'Bebidas' : 'Almacén'}`,
    );
  await page.locator('input[type=file]').setInputFiles({
    name: 'productos.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(filas.join('\n')),
  });
  await expect(page.getByText('Listo: 200 productos nuevos y 0 actualizados.')).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByRole('button', { name: 'Todos (200)' })).toBeVisible();
  await page.getByLabel('Buscar producto').fill('producto 199');
  await expect(page.getByText('Producto 199')).toBeVisible();
});

test('la planilla modelo se descarga, se sube tal cual y carga los ejemplos', async ({ page }) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/stock/importar');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar planilla (Excel)' }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toBe('productos-mostrador.xlsx');
  await page.locator('input[type=file]').setInputFiles({
    name: 'mis-productos.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(await archivo.path()),
  });
  await expect(page.getByText('Listo: 3 productos nuevos y 0 actualizados.')).toBeVisible();
  await page.goto('/stock');
  await page.getByLabel('Buscar producto').fill('alfajor triple');
  await expect(page.getByText('Alfajor triple chocolate')).toBeVisible();
});

test('buscar por código en Stock: lo encuentra o ofrece cargarlo', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Yerba 1 kg', precio: 400000, codigo: '7790000000023', stock: 12 },
    { nombre: 'Azúcar 1 kg', precio: 150000 },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('.mosaico', { hasText: 'Yerba' })).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByText('Azúcar 1 kg')).toBeVisible();

  await page.getByLabel('Buscar producto').fill('7790000000023');
  await expect(page.getByText('Yerba 1 kg')).toBeVisible();
  await expect(page.getByText('Azúcar 1 kg')).toBeHidden();

  await page.getByLabel('Buscar producto').fill('7790099999999');
  await expect(page.getByText('No encontramos el código 7790099999999.')).toBeVisible();
  await page.getByRole('button', { name: 'Cargar producto' }).click();
  await expect(page).toHaveURL(/producto\/nuevo\?codigo=7790099999999/);
});
