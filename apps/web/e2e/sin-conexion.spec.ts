import { expect, test, type Page } from '@playwright/test';
import { admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

async function preparar(page: Page) {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Coca-Cola 500 ml', precio: 180000, codigo: '7790895000997', stock: 1 },
    { nombre: 'Alfajor triple', precio: 120000 },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('.mosaico', { hasText: 'Coca-Cola' })).toBeVisible();
  // El service worker ya guardó la app y el catálogo está en el equipo.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(300);
  return d;
}

async function venderEnEfectivo(page: Page, producto: string) {
  await page.locator('.mosaico', { hasText: producto }).click();
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
  await page.getByRole('button', { name: 'Nueva venta' }).click();
}

async function ventasEnServidor(kioscoId: string): Promise<number> {
  const { rows } = await admin().query<{ n: string }>(
    'select count(*) as n from ventas where kiosco_id = $1',
    [kioscoId],
  );
  return Number(rows[0]?.n ?? 0);
}

test('sin internet se sigue vendiendo en efectivo y las ventas se suben solas', async ({
  page,
  context,
}) => {
  const d = await preparar(page);
  await context.setOffline(true);
  await expect(
    page.getByText('Sin internet. Seguí vendiendo, las ventas se suben solas cuando vuelva.'),
  ).toBeVisible();
  await expect(page.locator('.m-estado--sin-conexion:visible')).toHaveText('Sin internet');

  await page.locator('.mosaico', { hasText: 'Alfajor' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'QR (necesita internet)' })).toBeDisabled();
  await page.getByRole('button', { name: /Volver/ }).click();
  // En el celular el ticket está plegado: se despliega para vaciarlo.
  const plegado = page.getByRole('button', { name: /^Ticket · .*Ver$/ });
  if (await plegado.isVisible()) await plegado.click();
  await page.getByRole('button', { name: 'Vaciar ticket' }).click();
  await page.getByRole('button', { name: 'Vaciar', exact: true }).click();

  await venderEnEfectivo(page, 'Coca-Cola');
  await venderEnEfectivo(page, 'Coca-Cola');
  await expect(page.getByText('2 ventas esperando')).toBeVisible();
  expect(await ventasEnServidor(d.kioscoId)).toBe(0);

  await context.setOffline(false);
  await expect(page.getByText('Listo, se subieron 2 ventas')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => ventasEnServidor(d.kioscoId)).toBe(2);
  // Se vendió más de lo que había: el dueño ve el aviso.
  await expect(page.getByText(/quedó stock negativo en Coca-Cola 500 ml/)).toBeVisible();
});

test('recargar o cerrar la pestaña sin internet no pierde ventas', async ({ page, context }) => {
  const d = await preparar(page);
  await context.setOffline(true);
  await venderEnEfectivo(page, 'Alfajor');
  // Ticket a medio cargar.
  await page.locator('.mosaico', { hasText: 'Coca-Cola' }).click();
  await expect(page.getByText('Ticket · 1 producto')).toBeVisible();
  await page.waitForTimeout(200); // lo que tarda IndexedDB en guardar

  await page.reload();
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  await expect(page.getByText('1 venta esperando')).toBeVisible();
  await expect(page.getByText('Ticket · 1 producto')).toBeVisible();

  await page.close();
  const otra = await context.newPage();
  await otra.goto('/');
  await expect(otra.getByText('1 venta esperando')).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => ventasEnServidor(d.kioscoId), { timeout: 15_000 }).toBe(1);
  await expect(otra.getByText('venta esperando')).toHaveCount(0);
});

test('no se puede cerrar sesión con ventas sin subir', async ({ page, context }) => {
  const d = await preparar(page);
  await context.setOffline(true);
  await venderEnEfectivo(page, 'Alfajor');
  await page.getByRole('button', { name: 'Más' }).click();
  page.once('dialog', async (dlg) => {
    expect(dlg.message()).toContain('ventas sin subir');
    await dlg.accept();
  });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Más' })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => ventasEnServidor(d.kioscoId), { timeout: 15_000 }).toBe(1);
});
