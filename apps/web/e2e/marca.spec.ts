// Logo y texto al pie en lo que se imprime.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('el dueño sube su logo y un texto al pie, y salen en el ticket', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Alfajor triple', precio: 150000 }]);
  await entrar(page, d);

  await page.goto('/mas');
  await page.getByRole('button', { name: /Logo y tickets/ }).click();
  await expect(page.getByRole('heading', { name: 'Logo y tickets' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByText('Listo: el logo sale en lo que imprimas.')).toBeVisible();
  await expect(page.getByRole('img', { name: /Logo de/ })).toBeVisible();
  await page.getByLabel('Texto al pie (opcional)').fill('¡Gracias por tu compra!');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  await expect(page.locator('.marca__muestra')).toContainText('¡Gracias por tu compra!');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Una venta: el ticket impreso lleva el logo arriba y el texto al pie.
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Alfajor' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Efectivo', exact: true })
    .click()
    .catch(() => undefined);
  await page.getByRole('button', { name: 'Justo' }).click();
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).click();
  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const ticket = page.locator('.impreso').first();
  await expect(ticket).toBeVisible();
  await expect(ticket.locator('img.impreso__logo')).toHaveAttribute(
    'src',
    /\/api\/v1\/personalizacion\/logo\?v=1$/,
  );
  await expect(ticket).toContainText('¡Gracias por tu compra!');
  await page.emulateMedia({ media: null });
});
