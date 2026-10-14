import { expect, test } from '@playwright/test';
import { codigoTotp, entrar, invitacion, kioscoConDueno } from './ayuda.ts';

test('el dueño entra con email, contraseña y código de la app', async ({ page }) => {
  const d = await kioscoConDueno();
  await page.goto('/');
  await page.getByLabel('Email').fill(d.email);
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email, contraseña o código incorrectos.');

  await page.getByLabel('Contraseña').fill(d.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByLabel(/Código de 6 números/).fill(codigoTotp(d.secreto));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
});

test('una invitación nueva: contraseña, app de códigos y códigos de recuperación', async ({
  page,
}) => {
  const d = await kioscoConDueno();
  const token = await invitacion(d.kioscoId, `encargado-${d.kioscoId}@e2e.test`, 'encargado');
  await page.goto(`/invitacion#${token}`);
  await expect(page.getByRole('heading', { name: `Bienvenido a ${d.kiosco}` })).toBeVisible();
  await page.getByLabel('Tu nombre').fill('Beto');
  await page.getByLabel('Elegí una contraseña').fill('una frase bien larga');
  await page.getByLabel('Repetí la contraseña').fill('una frase bien larga');
  await page.getByRole('button', { name: 'Seguir' }).click();

  await page.getByRole('button', { name: 'Usar una app de códigos' }).click();
  const secreto = (await page.locator('code.secreto').textContent()) ?? '';
  const { base32Decodificar } = await import('./base32.ts');
  await page
    .getByLabel(/Código de 6 números que muestra/)
    .fill(codigoTotp(base32Decodificar(secreto)));
  await page.getByRole('button', { name: 'Confirmar' }).click();

  await expect(page.getByRole('heading', { name: 'Guardá estos códigos' })).toBeVisible();
  await expect(page.locator('.codigos li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Ya los guardé' }).click();
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
});

test('el cajero entra con PIN en el equipo autorizado y no en otro', async ({ page, browser }) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/mas/dispositivos');
  await page.getByRole('button', { name: 'Autorizar este equipo' }).click();
  await expect(page.getByText('(este equipo)')).toBeVisible();

  await page.goto('/mas/usuarios');
  await page.getByRole('button', { name: 'Agregar cajero' }).click();
  await page.getByLabel('Nombre').fill('Juli');
  await page.getByLabel(/PIN/).fill('2468');
  await page.getByRole('button', { name: 'Crear cajero' }).click();
  await expect(page.getByText('Juli')).toBeVisible();

  await page.goto('/mas');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // En el equipo autorizado aparece el ingreso con PIN.
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  await expect(page.getByText('Hola, Juli. Poné tu PIN.')).toBeVisible();
  for (const n of ['2', '4', '6', '0'])
    await page.getByRole('button', { name: n, exact: true }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email, contraseña o código incorrectos.');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  await expect(page.getByText('Atiende Juli')).toBeVisible();

  // Otro equipo (sin la cookie del equipo) no muestra el PIN: pide email.
  const otro = await browser.newContext();
  const p2 = await otro.newPage();
  await p2.goto('/');
  await expect(p2.getByLabel('Email')).toBeVisible();
  await expect(p2.getByText(/Poné tu PIN/)).toHaveCount(0);
  await otro.close();
});
