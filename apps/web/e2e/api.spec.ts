// API y automatizaciones: claves de acceso y avisos automáticos (docs/API.md).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar, kioscoConDueno } from './ayuda.ts';

test('la clave se ve una sola vez, entra a la API y se revoca; los avisos piden https', async ({
  page,
}) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/mas');
  await page.getByRole('button', { name: /API y automatizaciones/ }).click();
  await expect(page.getByRole('heading', { name: 'API y automatizaciones' })).toBeVisible();
  await expect(page.getByText('Todavía no creaste ninguna clave.')).toBeVisible();

  await page.getByLabel('¿Para qué es?').fill('n8n del resumen');
  await page.getByRole('button', { name: 'Crear clave' }).click();
  const unaVez = page.getByRole('status').filter({ hasText: 'Copialo ahora' });
  await expect(unaVez).toBeVisible();
  const clave = (await unaVez.locator('code').textContent()) ?? '';
  expect(clave).toMatch(/^mst_[A-Za-z0-9_-]{43}$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const conClave = { headers: { authorization: `Bearer ${clave}` } };
  expect((await page.request.get('/api/externa/v1/negocio', conClave)).status()).toBe(200);

  await page.getByRole('button', { name: 'Ya lo guardé' }).click();
  await expect(page.getByText(clave)).toBeHidden();

  await page.getByRole('button', { name: 'Revocar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revocar clave' }).click();
  await expect(page.getByText('Revocadas (1)')).toBeVisible();
  expect((await page.request.get('/api/externa/v1/negocio', conClave)).status()).toBe(401);

  const direccion = page.getByLabel('Dirección que recibe el aviso');
  await direccion.fill('http://n8n.ejemplo.com/webhook/ventas');
  await page.getByRole('button', { name: 'Agregar aviso' }).click();
  await expect(page.getByText('La dirección tiene que empezar con https://.')).toBeVisible();

  await direccion.fill('https://n8n.ejemplo.com/webhook/ventas');
  await page.getByLabel('Un producto llega al stock mínimo').check();
  await page.getByRole('button', { name: 'Agregar aviso' }).click();
  const secreto = page.getByRole('status').filter({ hasText: 'secreto' });
  await expect(secreto.locator('code')).toHaveText(/^whsec_/);
  await expect(page.getByText('Avisa: ventas, stock bajo')).toBeVisible();
  await expect(page.getByText('Todavía no mandó avisos.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
