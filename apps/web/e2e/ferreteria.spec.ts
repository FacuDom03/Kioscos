// Mostrador de ferretería: venta por metro con la lista de gremio (etapa I2).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

async function preparar(page: Page) {
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['venta_fraccionada', 'listas_precios', 'ubicaciones']);
  await productos(d.kioscoId, [
    {
      nombre: 'Cable unipolar 2.5mm² rojo',
      precio: 145000,
      precioGremio: 123000,
      unidad: 'metro',
      ubicacion: 'Pasillo 3 · B',
      stock: 184,
      codigo: 'ELE-0125',
    },
    { nombre: 'Llave de luz armada', precio: 390000, stock: 30, codigo: '7791234567893' },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();
  return d;
}

test('en PC se venden 12,5 m de cable con la lista de gremio sin mouse', async ({ page }, info) => {
  test.skip(info.project.name !== 'pc', 'Solo en computadora');
  const d = await preparar(page);

  await page.keyboard.press('F3');
  await expect(page.getByRole('button', { name: /^Gremio/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('F2');
  await page.keyboard.type('cable 2,5');
  await expect(page.getByRole('option', { name: /Pasillo 3 · B · Quedan 184 m/ })).toBeVisible();
  await page.keyboard.press('Enter');

  const dialogo = page.getByRole('dialog', { name: 'Cable unipolar 2.5mm² rojo' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByLabel('¿Cuántos metros?')).toBeFocused();
  await expect(dialogo.getByText('$ 1.230 el metro (gremio)')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await page.keyboard.type('12,5');
  await expect(dialogo.getByRole('button', { name: 'Sumar 12,5 m · $ 15.375' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialogo).toBeHidden();
  await expect(page.getByLabel('Buscar producto')).toBeFocused();

  const ticket = page.getByRole('region', { name: 'Ticket' });
  await expect(ticket.getByText('12,5 m')).toBeVisible();
  await expect(ticket.getByText('$ 1.230 el metro')).toBeVisible();
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 15.375');

  // Un producto por unidad se suma directo, con su precio (sin gremio cargado, el de mostrador).
  await page.keyboard.type('7791234567893');
  await page.keyboard.press('Enter');
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 19.275');

  await page.keyboard.press('F8');
  await page.keyboard.type('20000');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cobrado en efectivo · Vuelto $ 725')).toBeVisible();

  await expect
    .poll(async () => {
      const { rows } = await admin().query<{ lista: string; stock: string }>(
        `select v.lista, p.stock_actual as stock from ventas v
         join venta_items i on i.venta_id = v.id join productos p on p.id = i.producto_id
         where v.kiosco_id = $1 and p.unidad = 'metro'`,
        [d.kioscoId],
      );
      return rows[0];
    })
    .toEqual({ lista: 'gremio', stock: '171.500' });

  // La venta siguiente vuelve a la lista de mostrador.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Mostrador/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('en el celular se elige la cantidad con los botones rápidos', async ({ page }, info) => {
  test.skip(info.project.name === 'pc', 'Celular y tablet');
  await preparar(page);
  await page.getByRole('button', { name: /Cable unipolar/ }).click();
  const dialogo = page.getByRole('dialog', { name: 'Cable unipolar 2.5mm² rojo' });
  await dialogo.getByRole('button', { name: '5 m', exact: true }).click();
  await dialogo.getByRole('button', { name: 'Sumar 5 m · $ 7.250' }).click();
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 7.250');
});
