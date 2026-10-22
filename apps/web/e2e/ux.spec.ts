// Detalles de uso: diálogos modales, botón de cobrar siempre a la vista y barra del celular.
import { expect, test } from '@playwright/test';
import { activarModulos, entrar, kioscoConDueno, productos } from './ayuda.ts';

test('con un diálogo abierto no se puede tocar lo de atrás', async ({ page }) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['venta_fraccionada']);
  await productos(d.kioscoId, [
    { nombre: 'Martillo carpintero', precio: 1850000 },
    { nombre: 'Cable unipolar rojo', precio: 145000, unidad: 'metro', stock: 100 },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Martillo carpintero' }).click();
  await page.locator('.mosaico', { hasText: 'Cable unipolar rojo' }).click();
  await expect(page.getByRole('heading', { name: 'Cable unipolar rojo' })).toBeVisible();
  const cobrar = page.getByRole('button', { name: /^Cobrar/ }).first();
  const caja = await cobrar.boundingBox();
  expect(caja).not.toBeNull();
  const tapa = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('dialog'),
    { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 },
  );
  // Si el punto cae afuera del diálogo, igual está inerte: el clic no hace nada.
  await cobrar.click({ force: true, timeout: 2000 }).catch(() => {});
  expect(tapa || (await page.getByRole('heading', { name: 'Cobrar' }).count()) === 0).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('el botón para terminar el cobro se ve sin bajar', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Alfajor triple', precio: 120000 }]);
  await entrar(page, d);
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Alfajor triple' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Efectivo', exact: true }).click();
  const boton = page.getByRole('button', { name: 'Cobrar en efectivo', exact: true });
  await expect(boton).toBeInViewport({ ratio: 1 });
});

test('en el celular la barra tiene cinco secciones y Compras está en Más', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'pc', 'En la PC la barra lateral muestra todas');
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav.getByRole('button').filter({ visible: true })).toHaveCount(5);
  await nav.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: /^Compras/ }).click();
  await expect(page.getByRole('heading', { name: 'Compras' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Más', exact: true })).toHaveAttribute(
    'data-contiene',
    '',
  );
});
