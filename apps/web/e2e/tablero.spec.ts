// Tablero (etapa I6): se lee en los tres tamaños, sin scroll horizontal y sin problemas de axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { activarModulos, admin, entrar, kioscoConDueno, productos } from './ayuda.ts';

test('el tablero muestra qué se vende, qué no se mueve y qué falta', async ({ page }) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: true, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['venta_fraccionada', 'listas_precios', 'cuenta_corriente']);
  await productos(d.kioscoId, [
    { nombre: 'Cable unipolar 2,5 mm² rojo', precio: 145000, unidad: 'metro', stock: 184 },
    { nombre: 'Amoladora angular 115 mm', precio: 12000000, stock: 3 },
    { nombre: 'Tarugo 8 mm x 100', precio: 520000, unidad: 'caja', stock: 3 },
  ]);
  const c = admin();
  await c.query(`update productos set costo = 98000 where kiosco_id = $1 and unidad = 'metro'`, [
    d.kioscoId,
  ]);
  await c.query(
    `update productos set costo = 8500000 where kiosco_id = $1 and nombre like 'Amoladora%'`,
    [d.kioscoId],
  );
  await c.query(
    `update productos set stock_minimo = 10 where kiosco_id = $1 and nombre like 'Tarugo%'`,
    [d.kioscoId],
  );
  await c.query(
    `with t as (select id from turnos_caja where kiosco_id = $1 limit 1),
          u as (select usuario_id from membresias where kiosco_id = $1 limit 1),
          p as (select id from productos where kiosco_id = $1 and unidad = 'metro'),
          v as (insert into ventas (id, kiosco_id, turno_id, usuario_id, total, estado, creada_en_dispositivo)
                select gen_random_uuid(), $1, (select id from t), (select usuario_id from u), 1812500, 'cobrada', now()
                from generate_series(1, 3) returning id)
     insert into venta_items (id, kiosco_id, venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
     select gen_random_uuid(), $1, v.id, (select id from p), 'Cable', 12.5, 145000, 1812500 from v`,
    [d.kioscoId],
  );
  await entrar(page, d);
  await page.goto('/mas');
  await page.getByRole('button', { name: /Tablero/ }).click();
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();

  await expect(page.locator('.indicador').filter({ hasText: 'Vendido' })).toContainText('$ 54.375');
  const mas = page.getByRole('region', { name: 'Lo que más se vende' });
  await expect(mas).toContainText('Cable unipolar 2,5 mm² rojo · 37,5 m');
  const quietos = page.getByRole('region', { name: 'Sin ventas en 60 días' });
  await expect(quietos).toContainText('Amoladora angular 115 mm');
  await expect(quietos).toContainText('Plata parada: $ 255.000');
  await expect(page.getByRole('region', { name: 'Por reponer' })).toContainText(
    'Quedan 3 cajas de 10 cajas',
  );
  await expect(page.getByRole('region', { name: 'Por categoría' })).toContainText('ganancia 48 %');

  const ancho = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(ancho).toBeLessThanOrEqual(0);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);

  await page.getByLabel('Período').selectOption('hoy');
  await expect(page.locator('.indicador').filter({ hasText: 'Ventas' })).toContainText('3');
});

test('recién empezado, el tablero muestra los primeros pasos en vez de cuadros vacíos', async ({
  page,
}, info) => {
  const d = await kioscoConDueno('comercio', { cajaAbierta: false, rubro: 'ferreteria' });
  await activarModulos(d.kioscoId, ['venta_fraccionada', 'precios_proveedor']);
  await entrar(page, d);
  await page.goto('/tablero');
  const pasos = page.getByRole('region', { name: 'Primeros pasos' });
  await expect(pasos).toBeVisible();
  await expect(pasos.getByRole('button', { name: 'Lista de proveedor' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lo que más se vende' })).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `/tmp/claude-0/-home-user-Kioscos/a0caa3b8-ef77-578e-a76d-9de903651bbb/scratchpad/capturas/vacio-${info.project.name}.png`,
    fullPage: true,
  });
  await pasos.getByRole('button', { name: 'Cargar un producto' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo producto' })).toBeVisible();
});
