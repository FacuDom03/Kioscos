// Secciones Ventas y Compras y movimientos de stock, cada uno con su detalle.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, productos, irA } from './ayuda.ts';

test('Ventas, Compras y Movimientos muestran lo hecho, con su detalle', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Yerba 1 kg', precio: 400000, codigo: '7790000000023', stock: 5 },
  ]);
  await entrar(page, d);
  await page.goto('/');

  // Una venta en efectivo.
  await page.locator('.mosaico', { hasText: 'Yerba' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Efectivo', exact: true })
    .click()
    .catch(() => undefined);
  await page.getByLabel('¿Con cuánto paga?').fill('5000');
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).click();
  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();

  // Una compra: llegan 10 a $ 3.000.
  await page.goto('/compras/nueva');
  await page.getByLabel('Agregar producto').fill('7790000000023');
  await page.getByLabel('Agregar producto').press('Enter');
  await page.getByLabel('Cantidad').fill('10');
  await page.getByLabel('Costo por unidad').fill('3000');
  await page.getByRole('button', { name: 'Guardar compra' }).click();
  await expect(page.getByRole('heading', { name: 'Compras' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await nav.getByRole('button', { name: 'Ventas' }).click();
  await expect(page.getByRole('heading', { name: 'Ventas' })).toBeVisible();

  await expect(page.getByText(/1 venta por/)).toBeVisible();
  await page.getByRole('button', { name: /\$ 4\.000/ }).click();
  const venta = page.getByRole('dialog', { name: 'Venta' });
  await expect(venta.getByText('1 × Yerba 1 kg')).toBeVisible();
  await expect(venta.getByText('Efectivo (pagó con $ 5.000)')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await venta.getByRole('button', { name: 'Cerrar' }).click();

  await irA(page, 'Compras');
  await page.getByRole('button', { name: /\$ 30\.000/ }).click();
  const compra = page.getByRole('dialog', { name: 'Compra' });
  await expect(compra.getByText('10 × Yerba 1 kg a $ 3.000')).toBeVisible();
  await compra.getByRole('button', { name: 'Cerrar' }).click();

  await nav.getByRole('button', { name: 'Stock' }).click();
  await page.getByRole('button', { name: 'Movimientos' }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos de stock' })).toBeVisible();
  const lista = page.getByRole('region', { name: 'Movimientos de stock' });
  await expect(lista.getByText('+10')).toBeVisible();
  await expect(lista.getByText('−1')).toBeVisible();
});
