// Facturación ARCA en modo de prueba (ARCA y Afip SDK falsos en el servidor de e2e).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

test('se activa la facturación, se cargan los datos y cada venta sale con factura C', async ({
  page,
}) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Coca-Cola 500 ml', precio: 180000 }]);
  await entrar(page, d);

  // Sin activar, no aparece en Más; se activa desde Conexiones.
  await page.goto('/mas');
  await expect(page.getByRole('button', { name: /Facturación ARCA/ })).toBeHidden();
  await page.getByRole('button', { name: /Conexiones/ }).click();
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByRole('heading', { name: 'Facturación ARCA' })).toBeVisible();
  await expect(page.getByText(/Modo de prueba/)).toBeVisible();
  await page.getByRole('button', { name: 'Activar facturación' }).click();

  await expect(
    page.getByRole('heading', { name: 'Qué hacer en ARCA (una sola vez)' }),
  ).toBeVisible();
  await page.getByLabel('CUIT').fill('20-12345678-7');
  await page.getByLabel('Razón social o nombre').fill('Kiosco Anita');
  await page.getByLabel('Punto de venta (Web Services)').fill('3');
  await page.getByLabel('Domicilio comercial').fill('Av. Siempreviva 742');
  // Los términos: se leen desplegándolos y hay que aceptarlos para seguir.
  await page.getByText('Leer los términos y condiciones').click();
  await expect(page.getByRole('heading', { name: 'Lo que es responsabilidad tuya' })).toBeVisible();
  await page.getByLabel(/Leí y acepto los términos/).check();
  await page.getByRole('button', { name: 'Guardar y probar' }).click();
  await expect(page.getByText(/Revisá el CUIT/)).toBeVisible();
  await page.getByLabel('CUIT').fill('20-12345678-6');
  await page.getByRole('button', { name: 'Guardar y probar' }).click();
  await expect(page.getByText('Listo: la facturación está activa.')).toBeVisible();
  await expect(page.getByText('Activa', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Una venta en efectivo: sale con factura C.
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Coca-Cola' }).click();
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

  // Imprimir factura: espera el CAE y sale con los datos del comercio y el QR de ARCA.
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByRole('button', { name: 'Imprimir factura' }).click();
  const factura = page.locator('.factura-impresa');
  await expect(factura).toBeAttached({ timeout: 15_000 });
  await page.evaluate(() => document.documentElement.classList.add('imprimiendo-factura'));
  await page.emulateMedia({ media: 'print' });
  await expect(factura).toBeVisible();
  const texto = await factura.innerText();
  expect(texto).toContain('Kiosco Anita');
  expect(texto).toContain('CUIT 20-12345678-6');
  expect(texto).toContain('Responsable Monotributo');
  expect(texto).toMatch(/FACTURA C/);
  expect(texto).toMatch(/N° \d{5}-00000001/);
  expect(texto).toMatch(/CAE: \d{14}/);
  expect(texto).toContain('DE PRUEBA');
  await expect(factura.locator('svg.qr')).toBeVisible();
  await expect(page.locator('.impreso:not(.factura-impresa)').first()).toBeHidden();
  await page.emulateMedia({ media: null });
  await page.evaluate(() => document.documentElement.classList.remove('imprimiendo-factura'));

  await page.goto('/ventas');
  const fila = page.getByRole('button', { name: /Factura C \d{5}-00000001/ });
  await expect(async () => {
    await page.reload();
    await expect(fila).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await fila.click();
  const detalle = page.getByRole('dialog', { name: 'Venta' });
  await expect(detalle.getByText(/^CAE \d{14}/)).toBeVisible();
  await expect(detalle.getByText('(de prueba, no vale)')).toBeVisible();
  await expect(detalle.getByRole('button', { name: 'Imprimir factura' })).toBeVisible();
  await expect(detalle.getByRole('link', { name: 'Ver en ARCA' })).toHaveAttribute(
    'href',
    /^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=/,
  );
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
});
