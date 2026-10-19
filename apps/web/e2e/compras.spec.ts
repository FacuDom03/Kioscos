// Compras como factura de compra: proveedor, comprobante, renglones que suman stock o no.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

test('factura de compra con proveedor nuevo, un renglón que no suma stock y un flete', async ({
  page,
}) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Yerba 1 kg', precio: 400000, codigo: '7790000000023', stock: 5 },
  ]);
  await entrar(page, d);
  await page.goto('/compras/nueva');

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Proveedor nuevo' });
  await dialogo.getByLabel('Nombre del proveedor').fill('Distribuidora Sur');
  await dialogo.getByRole('button', { name: 'Agregar proveedor' }).click();
  await expect(page.getByLabel('Proveedor', { exact: true })).toHaveValue(/.+/);
  await page.getByLabel('Comprobante').selectOption('factura_a');
  await page.getByLabel('Número').fill('3-1234');
  // La mercadería ya entró con el remito: no se suma otra vez.
  await page.getByLabel('¿La mercadería entra ahora?').selectOption('no');

  await page.getByLabel('Agregar producto').fill('7790000000023');
  await page.getByLabel('Agregar producto').press('Enter');
  await page.getByLabel('Cantidad').fill('10');
  await page.getByLabel('Costo por unidad').fill('3000');
  await expect(page.getByLabel('Suma al stock')).not.toBeChecked();

  await page.getByRole('button', { name: /Agregar renglón sin producto/ }).click();
  await page.getByLabel('Qué es').fill('Flete');
  await page.getByLabel('Costo por unidad').nth(1).fill('5000');
  await expect(page.locator('.total-linea')).toContainText('$ 35.000');

  await page.getByLabel(/Total que dice la factura/).fill('36000');
  await expect(page.getByText('Hay una diferencia de $ 1.000')).toBeVisible();
  await page.getByLabel(/Total que dice la factura/).fill('35000');
  await expect(page.getByText('Coincide con la factura.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Guardar compra' }).click();
  await expect(page.getByRole('heading', { name: 'Compras' })).toBeVisible();
  const fila = page.getByRole('button', { name: /Distribuidora Sur · Factura A 00003-00001234/ });
  await expect(fila).toBeVisible();
  await fila.click();
  const detalle = page.getByRole('dialog', { name: 'Compra' });
  await expect(detalle.getByText('10 × Yerba 1 kg a $ 3.000 (no sumó stock)')).toBeVisible();
  await expect(detalle.getByText('1 × Flete a $ 5.000')).toBeVisible();
  await detalle.getByRole('button', { name: 'Cerrar' }).click();

  // El stock no cambió y la misma factura no se puede cargar dos veces.
  await page.goto('/stock');
  await expect(page.getByText('5 en stock')).toBeVisible();
  await page.goto('/compras/nueva');
  await page.getByLabel('Proveedor', { exact: true }).selectOption({ label: 'Distribuidora Sur' });
  await page.getByLabel('Comprobante').selectOption('factura_a');
  await page.getByLabel('Número').fill('0003-00001234');
  await page.getByLabel('Agregar producto').fill('7790000000023');
  await page.getByLabel('Agregar producto').press('Enter');
  await page.getByLabel('Costo por unidad').fill('3000');
  await page.getByRole('button', { name: 'Guardar compra' }).click();
  await expect(page.getByText(/Esa factura de ese proveedor ya está cargada/)).toBeVisible();
});
