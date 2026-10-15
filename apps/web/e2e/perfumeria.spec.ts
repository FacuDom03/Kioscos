// Perfumería (etapa I7). Listo cuando: una venta con 3 esmaltes de tonos distintos aplica el
// 3x2, baja el stock de cada tono y el ticket de cambio sale sin precios.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { uuidv7 } from '../../../packages/shared/src/uuid.ts';
import { activarModulos, admin, entrar, kioscoConDueno } from './ayuda.ts';

const MODULOS = ['variantes', 'promos', 'regalo', 'vencimientos'];

async function esmaltes(kioscoId: string) {
  const c = admin();
  const grupo = uuidv7();
  await c.query(
    `insert into grupos_variantes (id, kiosco_id, nombre, tipo) values ($1, $2, 'Esmalte cremoso', 'tono')`,
    [grupo, kioscoId],
  );
  const tonos: Record<string, string> = {};
  for (const [variante, color] of [
    ['Rojo', '#c0182b'],
    ['Nude', '#d8a48f'],
    ['Coral', '#ff6f61'],
  ] as const) {
    tonos[variante] = uuidv7();
    await c.query(
      `insert into productos (id, kiosco_id, nombre, precio, stock_actual, grupo_id, variante, color)
       values ($1, $2, $3, 320000, 10, $4, $5, $6)`,
      [tonos[variante], kioscoId, `Esmalte cremoso ${variante}`, grupo, variante, color],
    );
  }
  await c.query(
    `insert into promos (id, kiosco_id, nombre, lleva, paga, descuento, grupo_id)
     values ($1, $2, '3x2 en esmaltes', 3, 2, 100, $3)`,
    [uuidv7(), kioscoId, grupo],
  );
  return { grupo, tonos };
}

async function stock(id: string): Promise<number> {
  const { rows } = await admin().query<{ s: string }>(
    'select stock_actual as s from productos where id = $1',
    [id],
  );
  return Number(rows[0]?.s);
}

async function elegirTonos(page: Page, tonos: string[]) {
  await page.locator('.mosaico').filter({ hasText: 'Esmalte cremoso' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Esmalte cremoso' });
  await expect(dialogo).toContainText('¿Qué tono?');
  for (const t of tonos) await dialogo.getByRole('button', { name: new RegExp(`^${t},`) }).click();
  return dialogo;
}

async function cobrarJusto(page: Page) {
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Efectivo', exact: true }).click();
}

test('3 esmaltes de tonos distintos: 3x2, stock de cada tono, ticket de cambio sin precios y cambio', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'tablet', 'Celular y PC alcanzan');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'perfumeria' });
  await activarModulos(d.kioscoId, MODULOS);
  const { tonos } = await esmaltes(d.kioscoId);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();

  // Un solo mosaico para el esmalte; se eligen los tres tonos tocándolos.
  const dialogo = await elegirTonos(page, ['Rojo', 'Nude', 'Coral']);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await dialogo.getByRole('button', { name: 'Listo' }).click();

  const ticket = page.getByRole('complementary', { name: 'Ticket y total' });
  await expect(ticket).toContainText('Esmalte cremoso Rojo');
  await expect(ticket).toContainText('3x2 en esmaltes');
  await expect(ticket).toContainText('−$ 3.200');
  await expect(page.locator('.vender__total')).toContainText('6.400');

  // Para regalo: sale con ticket de cambio.
  await cobrarJusto(page);
  await page.getByLabel(/Es para regalo/).check();
  await page.getByRole('button', { name: 'Justo' }).click();
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).last().click();
  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Imprimir ticket de cambio (para regalo)' }),
  ).toBeVisible();

  // Baja el stock de cada tono y la venta guarda el descuento (se sube sola).
  await expect.poll(() => stock(tonos.Rojo ?? '')).toBe(9);
  expect(await stock(tonos.Nude ?? '')).toBe(9);
  expect(await stock(tonos.Coral ?? '')).toBe(9);
  const { rows } = await admin().query<{
    id: string;
    total: string;
    regalo: boolean;
    monto: string;
  }>(
    `select v.id, v.total, v.regalo, d.monto from ventas v
     join venta_descuentos d on d.venta_id = v.id and d.kiosco_id = v.kiosco_id
     where v.kiosco_id = $1`,
    [d.kioscoId],
  );
  expect(rows).toEqual([
    expect.objectContaining({ total: '640000', regalo: true, monto: '320000' }),
  ]);

  // El ticket de cambio sale sin precios (y el ticket común no sale con él).
  await page.evaluate(() => document.documentElement.classList.add('imprimiendo-cambio'));
  await page.emulateMedia({ media: 'print' });
  const impreso = page.locator('.cambio-impreso');
  await expect(impreso).toBeVisible();
  const texto = await impreso.innerText();
  expect(texto).toContain('TICKET DE CAMBIO');
  expect(texto).toContain('Esmalte cremoso Nude');
  expect(texto).toMatch(/Cambio hasta el \d\d\/\d\d\/\d{4}/);
  expect(texto).not.toContain('$');
  await expect(page.locator('.impreso:not(.cambio-impreso)').first()).toBeHidden();
  const codigo = /Código de cambio: ([0-9A-F]{8})/.exec(texto)?.[1] ?? '';
  expect(codigo).toBe(rows[0]?.id.slice(-8).toUpperCase());
  await page.emulateMedia({ media: null });
  await page.evaluate(() => document.documentElement.classList.remove('imprimiendo-cambio'));

  // Cambio: devuelve el Rojo (pagó $ 2.133,33 con el 3x2) y se lleva un Coral.
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await page.getByRole('button', { name: 'Cambio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cambio' })).toBeVisible();
  await page.getByLabel('Código del ticket de cambio').fill(codigo);
  await page.getByRole('button', { name: 'Buscar la venta' }).click();
  await page.getByRole('button', { name: 'Devolver uno más de Esmalte cremoso Rojo' }).click();
  await expect(page.locator('.cambios__favor')).toContainText('$ 2.133,33');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Elegir lo que se lleva' }).click();

  await expect(page.getByText(`Cambio del ticket ${codigo}`)).toBeVisible();
  await (await elegirTonos(page, ['Coral'])).getByRole('button', { name: 'Listo' }).click();
  await expect(ticket).toContainText('Devuelve Esmalte cremoso Rojo');
  await expect(page.locator('.vender__total')).toContainText('1.066,67');
  await cobrarJusto(page);
  await expect(page.getByRole('heading', { name: 'Cobrar la diferencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Justo' }).click();
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).last().click();
  await expect(page.getByText(/^Cambio hecho · Cobrada la diferencia/)).toBeVisible();
  await expect.poll(() => stock(tonos.Rojo ?? '')).toBe(10);
  expect(await stock(tonos.Coral ?? '')).toBe(8);
});

test('alta de un producto con tonos, promos y vencimientos', async ({ page }, info) => {
  test.skip(info.project.name === 'tablet', 'Celular y PC alcanzan');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'perfumeria' });
  await activarModulos(d.kioscoId, MODULOS);
  await entrar(page, d);

  // Producto con tonos desde Stock.
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Tonos y tamaños' }).click();
  await page.getByRole('button', { name: 'Nuevo producto con tonos' }).click();
  await page.getByLabel('Nombre del producto').fill('Labial mate');
  await page.getByLabel('Precio de cada uno').fill('5400');
  await page.getByLabel('Tono 1').fill('Cereza');
  await page.getByLabel('Stock').first().fill('6');
  await page.getByLabel('Tono 2').fill('Malva');
  await page.getByLabel('Stock').nth(1).fill('4');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'Labial mate' })).toBeVisible();
  await expect(page.getByText('2 tonos · Quedan 10 en total')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cereza/ })).toContainText('Quedan 6');

  // Promo para todos los tonos.
  await page.goto('/promos');
  await page.getByRole('button', { name: '2da al 50%' }).click();
  await page.getByLabel('¿A qué se aplica?').selectOption({ label: 'Labial mate' });
  await page.getByRole('button', { name: 'Crear promo' }).click();
  await expect(page.getByText('Promo creada. Ya se aplica en Vender.')).toBeVisible();
  const fila = page.locator('.fila--promo').filter({ hasText: '2da con 50% menos en labial mate' });
  await expect(fila).toContainText('Corriendo');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  // En Vender, dos labiales: el segundo sale a mitad de precio.
  await page.goto('/');
  await page.locator('.mosaico').filter({ hasText: 'Labial mate' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Labial mate' });
  await dialogo.getByRole('button', { name: /^Cereza,/ }).click();
  await dialogo.getByRole('button', { name: /^Malva,/ }).click();
  await dialogo.getByRole('button', { name: 'Listo' }).click();
  await expect(page.locator('.vender__total')).toContainText('8.100');

  // Vencimientos: un lote vencido y otro que vence pronto.
  const { rows } = await admin().query<{ id: string }>(
    `select id from productos where kiosco_id = $1 order by variante`,
    [d.kioscoId],
  );
  const dueno = await admin().query<{ usuario_id: string }>(
    `select usuario_id from membresias where kiosco_id = $1`,
    [d.kioscoId],
  );
  for (const [producto, dias] of [
    [rows[0]?.id, -3],
    [rows[1]?.id, 12],
  ] as const) {
    await admin().query(
      `insert into lotes (id, kiosco_id, producto_id, vence_en, cantidad, usuario_id)
       values ($1, $2, $3, current_date + $4::int, 6, $5)`,
      [uuidv7(), d.kioscoId, producto, dias, dueno.rows[0]?.usuario_id],
    );
  }
  await page.goto('/stock');
  await page.getByRole('button', { name: 'Ver vencimientos' }).click();
  const vencidos = page.getByRole('region', { name: 'Vencidos' });
  await expect(vencidos).toContainText('Labial mate Cereza');
  await expect(page.getByRole('region', { name: 'Vencen en los próximos 30 días' })).toContainText(
    'Labial mate Malva',
  );
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await vencidos.getByRole('button', { name: 'Ya no queda' }).click();
  await expect(vencidos).toBeHidden();
});
