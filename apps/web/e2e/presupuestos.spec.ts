// Presupuestos y remitos (etapa I4): se crea, se manda, vence y se convierte en venta.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

test('un presupuesto se guarda, se manda, vence y se cobra sin cargar nada de nuevo', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'pc', 'Se prueba en la PC del mostrador');
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['venta_fraccionada', 'listas_precios', 'presupuestos']);
  await productos(d.kioscoId, [
    {
      nombre: 'Cable unipolar 2.5mm² rojo',
      precio: 145000,
      precioGremio: 123000,
      unidad: 'metro',
      stock: 184,
      codigo: 'ELE-0125',
    },
    { nombre: 'Llave de luz armada', precio: 390000, stock: 30, codigo: '7791234567893' },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: d.kiosco })).toBeVisible();

  // Se arma el ticket con el teclado y se guarda como presupuesto (F6).
  await page.keyboard.press('F3');
  await page.keyboard.press('F2');
  await page.keyboard.type('cable 2,5');
  await page.keyboard.press('Enter');
  await page.keyboard.type('12,5');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Buscar producto')).toBeFocused();
  await page.keyboard.type('7791234567893');
  await page.keyboard.press('Enter');
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 19.275');
  await page.keyboard.press('F6');
  const dialogo = page.getByRole('dialog', { name: 'Guardar presupuesto' });
  await expect(dialogo.getByLabel('Para quién (opcional)')).toBeFocused();
  await page.keyboard.type('Obra de calle 9');
  await dialogo.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByRole('heading', { name: 'Presupuesto 1' })).toBeVisible();
  await expect(page.getByText('Abierto')).toBeVisible();
  const whatsapp = page.getByRole('link', { name: 'Mandar por WhatsApp' });
  const texto = decodeURIComponent(
    ((await whatsapp.getAttribute('href')) ?? '').replace('https://wa.me/?text=', ''),
  );
  expect(texto).toContain('*Presupuesto 1*');
  expect(texto).toContain('Para: Obra de calle 9');
  expect(texto).toContain('12,5 m Cable unipolar 2.5mm² rojo: $ 15.375');
  expect(texto).toContain('*Total: $ 19.275*');
  expect(texto).toContain('Precios de gremio.');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  // El ticket quedó vacío para el cliente que sigue.
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page.getByText('El ticket está vacío.')).toBeVisible();

  // Pasa el tiempo: vence y el cable aumenta. Se cobra con los precios de hoy.
  const c = admin();
  await c.query(`update presupuestos set vence_en = current_date - 1 where kiosco_id = $1`, [
    d.kioscoId,
  ]);
  await c.query(
    `update productos set precio_gremio = 130000 where kiosco_id = $1 and unidad = 'metro'`,
    [d.kioscoId],
  );
  await page.goto('/presupuestos');
  await page.getByRole('button', { name: 'Todos' }).click();
  await page.getByRole('button', { name: /Presupuesto 1 · Obra de calle 9/ }).click();
  await expect(page.getByText('Vencido')).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar con los precios de hoy' }).click();

  await expect(page.getByText('Estás cobrando el presupuesto 1.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Gremio/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.m-cartel__monto')).toHaveText('$ 20.150');
  await page.keyboard.press('F8');
  await page.keyboard.type('25000');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cobrado en efectivo · Vuelto $ 4.850')).toBeVisible();

  // Remito sin precios para el que se lleva la mercadería.
  await page.evaluate(() => document.documentElement.classList.add('imprimiendo-remito'));
  await page.emulateMedia({ media: 'print' });
  const remito = page.locator('.remito-impreso');
  await expect(remito).toBeVisible();
  await expect(remito).toContainText('12,5 m Cable unipolar 2.5mm² rojo');
  await expect(remito).not.toContainText('$');
  await page.emulateMedia({ media: 'screen' });

  await expect
    .poll(async () => {
      const { rows } = await c.query<{ estado: string; vendido: boolean }>(
        `select estado, venta_id is not null as vendido from presupuestos where kiosco_id = $1`,
        [d.kioscoId],
      );
      return rows[0];
    })
    .toEqual({ estado: 'vendido', vendido: true });
});
