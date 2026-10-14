import { expect, test, type Page } from '@playwright/test';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

async function preparar(page: Page) {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Coca-Cola 500 ml', precio: 180000, codigo: '7790895000997' },
    { nombre: 'Alfajor triple', precio: 120000, codigo: '7790040000001' },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  return d;
}

test('venta completa en efectivo con vuelto', async ({ page }) => {
  await preparar(page);
  await page.locator('.mosaico', { hasText: 'Coca-Cola 500 ml' }).click();
  await page.locator('.mosaico', { hasText: 'Coca-Cola 500 ml' }).click();
  await page.getByLabel('Buscar producto').fill('alfajor');
  await page.getByLabel('Buscar producto').press('Enter');
  await expect(page.getByText('Ticket · 3 productos')).toBeVisible();
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 4.800');

  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Efectivo', exact: true })
    .click()
    .catch(() => undefined);
  await page.getByLabel('¿Con cuánto paga?').fill('10.000');
  await expect(page.locator('.vuelto__monto')).toHaveText('$ 5.200');
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).click();

  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();
  await expect(page.getByText('Cobrado en efectivo · Vuelto $ 5.200')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await expect(page.getByText('El ticket está vacío.')).toBeVisible();

  // La venta se subió: aparece en la caja.
  await page.goto('/caja');
  await expect(page.getByText('Vendiste hoy')).toContainText('$ 4.800');
  await expect(page.getByText('Efectivo: $ 4.800')).toBeVisible();
});

test('producto sin código con precio libre y transferencia', async ({ page }) => {
  await preparar(page);
  await page.getByRole('button', { name: /Producto sin código/ }).click();
  await page.getByLabel('Monto').fill('2.500');
  await page.getByLabel('Descripción (opcional)').fill('Fiambre');
  await page.getByRole('button', { name: 'Sumar al ticket' }).click();
  await expect(page.getByText('Fiambre')).toBeVisible();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .last()
    .click();
  await page.getByRole('button', { name: 'Transferencia', exact: true }).click();
  await page.getByRole('button', { name: 'Transferencia recibida' }).click();
  await expect(page.getByText('Cobrado con transferencia')).toBeVisible();
});

test('código desconocido: ofrece cargar el producto o vender con precio libre', async ({
  page,
}) => {
  await preparar(page);
  await page.getByLabel('Buscar producto').fill('7791234567890');
  await page.getByLabel('Buscar producto').press('Enter');
  await expect(page.getByText('No encontramos el código 7791234567890.')).toBeVisible();
  await page.getByRole('button', { name: 'Cargar producto' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo producto' })).toBeVisible();
  await expect(page.getByText('7791234567890')).toBeVisible();
});

test('cierre de caja con diferencia', async ({ page }) => {
  await preparar(page);
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
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  await page.goto('/caja');
  await page.getByRole('button', { name: 'Anotar un gasto' }).click();
  await page.getByLabel('Monto').fill('300');
  await page.getByLabel('Motivo').fill('Bolsas');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Gasto: Bolsas')).toBeVisible();
  // 10.000 de cambio + 1.800 − 300 = 11.500
  await expect(page.locator('.tarjeta-efectivo__total')).toContainText('$ 11.500');
  await page.getByLabel('¿Cuánto contaste?').fill('11.000');
  await expect(page.getByText('Faltan $ 500.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByRole('heading', { name: 'Caja cerrada' })).toBeVisible();
  await expect(page.getByText('Faltan $ 500.')).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
});

test('en PC la venta completa se hace sin mouse', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'Solo en computadora');
  await preparar(page);
  await page.keyboard.press('F2');
  await page.keyboard.type('3*7790895000997');
  await page.keyboard.press('Enter');
  await page.keyboard.type('alfajor');
  await page.keyboard.press('Enter');
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 6.600');
  // Restar un alfajor desde el ticket con las flechas y "-".
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('-');
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 5.400');
  await expect(page.getByRole('button', { name: 'Cobrar en efectivo · F8' })).toBeVisible();
  await page.keyboard.press('F8');
  await page.keyboard.type('6000');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cobrado en efectivo · Vuelto $ 600')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('El ticket está vacío.')).toBeVisible();
  await expect(page.getByLabel('Buscar producto')).toBeFocused();
  // Esc con ticket pide confirmación antes de vaciar.
  await page.keyboard.type('7790895000997');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '¿Vaciar el ticket?' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('El ticket está vacío.')).toBeVisible();
});

test('el ticket sigue ahí después de recargar la página', async ({ page }) => {
  await preparar(page);
  await page.locator('.mosaico', { hasText: 'Alfajor triple' }).click();
  await page.reload();
  await expect(page.getByText('Ticket · 1 producto')).toBeVisible();
});

test('abrir la caja desde cero y vender; lo pendiente se sube al volver a abrir la app', async ({
  page,
}) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: false });
  await productos(d.kioscoId, [{ nombre: 'Agua', precio: 90000 }]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Abrir caja' })).toBeVisible();
  await page.getByLabel('¿Con cuánto cambio arrancás?').fill('5.000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.locator('.mosaico', { hasText: 'Agua' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.mosaico', { hasText: 'Agua' })).toBeVisible();
  await page.goto('/caja');
  await expect(page.locator('.tarjeta-efectivo')).toContainText('$ 5.000');
});
