// Rubros: el dueño confirma el rubro al entrar por primera vez y la app toma su diseño
// (docs/decisiones/009-rubros.md).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { admin, entrar, kioscoConDueno } from './ayuda.ts';

const ETIQUETAS_AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('el dueño de una ferretería confirma el rubro y arranca con el diseño sobrio', async ({
  page,
}) => {
  const d = await kioscoConDueno('comercio', {
    cajaAbierta: true,
    rubro: 'ferreteria',
    configurado: false,
  });
  await entrar(page, d);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '¿Qué tipo de negocio tenés?' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Ferretería/ })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-estilo', 'sobrio');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'sobrio');
  expect((await new AxeBuilder({ page }).withTags(ETIQUETAS_AXE).analyze()).violations).toEqual([]);

  // Probar otro rubro cambia el diseño al instante; volver a ferretería lo deja sobrio.
  await page.getByRole('radio', { name: /Kiosco/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-estilo', 'kiosco');
  await page.getByRole('radio', { name: /Ferretería/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-estilo', 'sobrio');
  await page.getByRole('button', { name: 'Seguir con ferretería' }).click();

  await expect(page.getByRole('heading', { name: 'Tu ferretería, lista para usar' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Electricidad' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Jardín' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Presupuestos y remitos/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Cuenta corriente/ })).not.toBeChecked();
  expect((await new AxeBuilder({ page }).withTags(ETIQUETAS_AXE).analyze()).violations).toEqual([]);
  await page.getByRole('checkbox', { name: 'Construcción' }).uncheck();
  await page.getByRole('checkbox', { name: 'Jardín' }).check();
  await page.getByRole('button', { name: 'Empezar' }).click();

  // Ya en la app: sin toldo ni estrella, el total en texto.
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  await expect(page.locator('.m-marco__toldo')).toBeHidden();
  await expect(page.locator('.m-cartel svg')).toBeHidden();
  await expect(page.getByText('$ 0')).toBeVisible();

  const { rows } = await admin().query<{ nombre: string }>(
    'select nombre from categorias where kiosco_id = $1 order by orden',
    [d.kioscoId],
  );
  expect(rows.map((r) => r.nombre)).toEqual([
    'Electricidad',
    'Plomería',
    'Pinturería',
    'Bulonería',
    'Herramientas',
    'Jardín',
  ]);
  const k = await admin().query<{ rubro: string; configurado: boolean }>(
    'select rubro, configurado from kioscos where id = $1',
    [d.kioscoId],
  );
  expect(k.rows[0]).toEqual({ rubro: 'ferreteria', configurado: true });
});

test('desde Más se cambia el rubro y vuelve el diseño de kiosco', async ({ page }) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-estilo', 'sobrio');

  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: /Tu negocio/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu negocio' })).toBeVisible();
  await page.getByRole('button', { name: 'Cambiar rubro' }).click();
  await page.getByRole('radio', { name: /Kiosco/ }).check();
  await page.getByRole('button', { name: 'Seguir con kiosco' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByRole('heading', { name: 'Más' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-estilo', 'kiosco');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'noche');
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page.locator('.m-cartel svg')).toBeVisible();
});

test('Apariencia ofrece solo los temas del estilo del rubro', async ({ page }) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'perfumeria' });
  await entrar(page, d);
  await page.goto('/mas/apariencia');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'boutique');
  const radios = page.getByRole('radiogroup', { name: 'Apariencia' }).getByRole('radio');
  await expect(radios).toHaveCount(4);
  for (const nombre of ['Claro', 'Grafito', 'Boutique', 'Alto contraste']) {
    await expect(page.getByRole('radio', { name: new RegExp(`^${nombre}`) })).toBeVisible();
  }
  await expect(page.getByRole('radio', { name: /^Noche/ })).toHaveCount(0);
});
