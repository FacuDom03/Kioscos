import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, pagarQr, productos } from './ayuda.ts';

test('conectar Mercado Pago y cobrar con QR', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc' && info.project.name !== 'celular', 'En celular y PC');
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Fernet 750', precio: 1200000 }]);
  await entrar(page, d);

  await page.goto('/mas/conexiones');
  await expect(page.getByText('Sin conectar')).toBeVisible();
  await page.getByRole('link', { name: 'Conectar Mercado Pago' }).click();
  await expect(page.getByText('Listo, Mercado Pago quedó conectado.')).toBeVisible();
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Probar conexión' }).click();
  await expect(page.getByText('La conexión anda bien. Ya podés cobrar con QR.')).toBeVisible();

  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Fernet' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^(QR|Cobrar con QR)/ })
    .first()
    .click()
    .catch(() => undefined);
  if (info.project.name === 'pc') {
    await page.getByRole('button', { name: 'QR', exact: true }).click();
  }
  await expect(page.getByRole('img', { name: /Código QR para pagar \$ 12\.000/ })).toBeVisible();
  const caja = await page.getByRole('img', { name: /Código QR/ }).boundingBox();
  expect(caja!.width).toBeGreaterThanOrEqual(info.project.name === 'pc' ? 260 : 220);
  await expect(page.getByText('Esperando el pago')).toBeVisible();

  await pagarQr(d.kioscoId);
  await expect(page.getByText(/Mercado Pago confirmó el pago a las \d\d:\d\d/)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await page.goto('/caja');
  await expect(page.getByText('QR: $ 12.000')).toBeVisible();
});
