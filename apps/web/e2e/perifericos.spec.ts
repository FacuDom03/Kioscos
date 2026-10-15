import { expect, test } from '@playwright/test';
import { digitoVerificadorEan13 } from '../../../packages/shared/src/balanza.ts';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

test.beforeEach(async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Coca-Cola 500 ml', precio: 180000, codigo: '7790895000997' },
    { nombre: 'Queso por kilo', precio: 900000, codigo: '00123' },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('.mosaico', { hasText: 'Coca-Cola' })).toBeVisible();
});

test('el lector USB suma el producto aunque el foco no esté en el buscador', async ({ page }) => {
  await page.locator('h1').click(); // foco fuera del buscador
  await page.keyboard.type('7790895000997', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ticket · 1 producto')).toBeVisible();
  // Una persona tecleando lento no dispara el lector.
  await page.locator('h1').click();
  await page.keyboard.type('7790895000997', { delay: 80 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ticket · 1 producto')).toBeVisible();
});

test('una etiqueta de balanza suma el producto con el precio de la etiqueta', async ({ page }) => {
  const doce = '200012300750'; // producto 00123, $ 750
  await page.getByLabel('Buscar producto').fill(doce + digitoVerificadorEan13(doce));
  await page.getByLabel('Buscar producto').press('Enter');
  await expect(page.locator('.ticket__linea', { hasText: 'Queso por kilo' })).toContainText(
    '$ 750',
  );
});

test('una etiqueta de balanza con peso suma los kilos con sus decimales', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'mostrador.equipo',
      JSON.stringify({ balanza: { valor: 'peso', activa: true } }),
    ),
  );
  await page.reload();
  const doce = '200012300350'; // producto 00123, 0,350 kg
  await page.getByLabel('Buscar producto').fill(doce + digitoVerificadorEan13(doce));
  await page.getByLabel('Buscar producto').press('Enter');
  const linea = page.locator('.ticket__linea', { hasText: 'Queso por kilo' });
  await expect(linea).toContainText('0,35');
  await expect(linea).toContainText('$ 3.150');
});

test('el ticket impreso lleva lo que pide la ley', async ({ page }) => {
  await page.locator('.mosaico', { hasText: 'Coca-Cola' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Efectivo', exact: true })
    .click()
    .catch(() => undefined);
  await page.getByLabel('¿Con cuánto paga?').fill('2000');
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).click();
  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const impreso = page.locator('.impreso');
  await expect(impreso).toBeVisible();
  await expect(impreso).toContainText('Documento no válido como factura');
  await expect(impreso).toContainText('Coca-Cola 500 ml');
  await expect(impreso).toContainText('TOTAL$ 1.800');
  await expect(impreso).toContainText('Vuelto $ 200');
  await page.emulateMedia({ media: 'screen' });
});
