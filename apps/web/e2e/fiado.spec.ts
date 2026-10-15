// Fiado / cuenta corriente (etapa I5): se anota con límite, se avisa y se cobra.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { uuidv7 } from '../../../packages/shared/src/uuid.ts';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

test('en el almacén se fía con límite, se avisa por WhatsApp y se cobra la deuda', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'tablet', 'Celular y PC alcanzan');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'almacen' });
  await activarModulos(d.kioscoId, ['cuenta_corriente']);
  await productos(d.kioscoId, [{ nombre: 'Leche entera 1 l', precio: 135000, stock: 40 }]);
  const c = admin();
  const rosa = uuidv7();
  await c.query(
    `insert into clientes (id, kiosco_id, nombre, telefono, limite) values ($1, $2, 'Rosa', '11 5555-0000', 4000000)`,
    [rosa, d.kioscoId],
  );
  await c.query(
    `insert into movimientos_cuenta (id, kiosco_id, cliente_id, tipo, monto, usuario_id)
     select $1, $2, $3, 'ajuste', 1820000, usuario_id from membresias where kiosco_id = $2 and rol = 'dueno'`,
    [uuidv7(), d.kioscoId, rosa],
  );
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();

  await page.getByRole('button', { name: /Leche entera/ }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Fiado', exact: true }).click();
  await page.getByLabel('¿A quién se lo anotás?').fill('ros');
  await page.getByRole('button', { name: /^Rosa/ }).click();
  await expect(page.getByText('Debe $ 18.200')).toBeVisible();
  await expect(page.getByText('Debe $ 19.550')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Anotar $ 1.350 en el fiado' }).click();

  await expect(page.getByText('Anotado en la cuenta de Rosa · Debe $ 19.550')).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Mandarle el detalle por WhatsApp' })
    .getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/5491155550000\?text=/);
  expect(decodeURIComponent(href ?? '')).toContain('Tu cuenta queda en $ 19.550.');
  await page.getByRole('button', { name: 'Nueva venta' }).click();

  // Con el límite bajo, no deja anotar más.
  await c.query(`update clientes set limite = 1950000 where id = $1`, [rosa]);
  await page.getByRole('button', { name: /Leche entera/ }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Fiado', exact: true }).click();
  await page.getByLabel('¿A quién se lo anotás?').fill('rosa');
  await page.getByRole('button', { name: /^Rosa/ }).click();
  await expect(page.getByText('Con esta compra pasa su límite.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Anotar/ })).toBeDisabled();

  // Rosa paga $ 5.000 en efectivo: baja la deuda y entra en la caja.
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Fiado' })).toBeVisible();
  await expect(page.getByText('Te deben $ 19.550 en total.')).toBeVisible();
  await page.getByRole('button', { name: /^Rosa/ }).click();
  await page.getByLabel('¿Cuánto paga?').fill('5000');
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText('Rosa todavía debe $ 14.550.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Pago en efectivo/ })).toBeVisible();
  await page.goto('/caja');
  await expect(page.getByText('+ Pagos de cuentas en efectivo')).toBeVisible();
  await expect(page.getByText('A cuenta (no entra en la caja):')).toBeVisible();
});
