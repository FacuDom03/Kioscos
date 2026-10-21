// Factura a nombre de alguien, como en Odoo: por defecto consumidor final; si el cliente pide
// factura, se lo busca en ARCA por CUIT, se guarda y la factura sale con sus datos.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

test('se cobra a nombre de un cliente buscado en ARCA y la factura lleva su CUIT', async ({
  page,
}) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Taladro', precio: 9000000 }]);
  await activarModulos(d.kioscoId, ['facturacion']);
  await admin().query(
    `insert into config_fiscal (id, kiosco_id, cuit, razon_social, condicion, punto_venta, domicilio, estado, activada_en, terminos_version, terminos_aceptados_en)
     values (gen_random_uuid(), $1, '20123456786', 'Kiosco Anita', 'monotributo', 3, 'Calle 1', 'activa', now(), '2026-10-20', now())`,
    [d.kioscoId],
  );
  await entrar(page, d);
  await page.goto('/');

  await page.locator('.mosaico', { hasText: 'Taladro' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  // Por defecto, consumidor final, sin tocar nada.
  const fila = page.locator('.factura-a');
  await expect(fila).toContainText('Consumidor final');
  await fila.getByRole('button', { name: 'A nombre de alguien' }).click();

  const dialogo = page.getByRole('dialog', { name: '¿A nombre de quién?' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('Todavía no cargaste clientes con CUIT o DNI.')).toBeVisible();
  await dialogo.getByLabel('Buscar por nombre, CUIT o DNI').fill('20-11111111-2');
  await dialogo.getByRole('button', { name: 'Cliente nuevo' }).click();
  // El CUIT completo se busca solo en ARCA y completa los datos.
  const nuevo = page.getByRole('dialog', { name: 'Cliente nuevo' });
  await expect(nuevo.getByText('Datos de ARCA. Revisalos y guardá.')).toBeVisible();
  await expect(nuevo.getByLabel('Nombre o razón social')).toHaveValue('PEREZ ANA');
  await expect(nuevo.getByLabel('Condición frente al IVA')).toHaveValue('responsable_inscripto');
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await nuevo.getByRole('button', { name: 'Guardar y facturarle' }).click();

  await expect(fila).toContainText('PEREZ ANA');
  await expect(fila).toContainText('CUIT 20-11111111-2, responsable inscripto');
  await page
    .getByRole('button', { name: 'Efectivo', exact: true })
    .click()
    .catch(() => undefined);
  await page.getByRole('button', { name: 'Justo' }).click();
  await page.getByRole('button', { name: 'Cobrar en efectivo' }).click();
  await expect(page.getByRole('heading', { name: 'Cobrado' })).toBeVisible();

  // La factura impresa sale a su nombre.
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByRole('button', { name: 'Imprimir factura' }).click();
  const factura = page.locator('.factura-impresa');
  await expect(factura).toBeAttached({ timeout: 15_000 });
  await page.evaluate(() => document.documentElement.classList.add('imprimiendo-factura'));
  await page.emulateMedia({ media: 'print' });
  await expect(factura).toContainText('A: PEREZ ANA');
  await expect(factura).toContainText('CUIT 20-11111111-2');
  await expect(factura).toContainText('IVA Responsable Inscripto');
  await page.emulateMedia({ media: null });
});

test('desde $ 10.000.000 hay que elegir a quién facturarle para cobrar', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Generador', precio: 1_200_000_000 }]);
  await activarModulos(d.kioscoId, ['facturacion']);
  await entrar(page, d);
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Generador' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await expect(page.getByText(/ARCA pide el DNI o CUIT de quien compra/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Efectivo', exact: true })).toBeHidden();
});

test('sin la facturación no aparece nada de facturas al cobrar', async ({ page }) => {
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Alfajor', precio: 150000 }]);
  await entrar(page, d);
  await page.goto('/');
  await page.locator('.mosaico', { hasText: 'Alfajor' }).click();
  await page
    .getByRole('button', { name: /^Cobrar/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await expect(page.locator('.factura-a')).toHaveCount(0);
});

test('en Tu negocio se elige vender y llevar los números o vender y facturar', async ({ page }) => {
  const d = await kioscoConDueno();
  await entrar(page, d);
  await page.goto('/mas');
  await page.getByRole('button', { name: /Tu negocio/ }).click();
  const vender = page.getByRole('radio', { name: /Vender y llevar los números/ });
  const facturar = page.getByRole('radio', { name: /Vender y facturar/ });
  await expect(vender).toBeChecked();
  await facturar.check();
  await expect(page.getByText(/se termina de preparar en Más → Facturación ARCA/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: /Facturación ARCA/ })).toBeVisible();

  // Volver a lo simple apaga la facturación (y lo de clientes) sin tocar lo demás.
  await page.getByRole('button', { name: /Tu negocio/ }).click();
  await page.getByRole('radio', { name: /Vender y llevar los números/ }).check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: /Facturación ARCA/ })).toBeHidden();
});
