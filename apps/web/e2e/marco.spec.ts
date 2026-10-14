import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TEMAS = [
  { id: 'noche', nombre: 'Noche', fondo: 'rgb(17, 25, 54)', hex: '#111936' },
  { id: 'dia', nombre: 'Día', fondo: 'rgb(238, 241, 245)', hex: '#EEF1F5' },
  { id: 'pizarron', nombre: 'Pizarrón', fondo: 'rgb(21, 48, 42)', hex: '#15302A' },
  { id: 'contraste', nombre: 'Alto contraste', fondo: 'rgb(0, 0, 0)', hex: '#000000' },
] as const;

async function abrirConTema(page: Page, tema: string) {
  await page.addInitScript((t) => {
    // Solo la primera carga de la página: no pisar lo que elija la prueba después.
    if (!sessionStorage.getItem('prueba.tema')) {
      localStorage.setItem('mostrador.tema', t);
      sessionStorage.setItem('prueba.tema', '1');
    }
  }, tema);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mi kiosco' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const tema of TEMAS) {
  test.describe(`tema ${tema.nombre}`, () => {
    test('Vender entra sin scroll y la navegación va donde corresponde', async ({ page }, info) => {
      await abrirConTema(page, tema.id);

      await expect(page.locator('html')).toHaveAttribute('data-tema', tema.id);
      await expect(page.locator('body')).toHaveCSS('background-color', tema.fondo);

      // Sin scroll horizontal ni vertical en Vender.
      const medidas = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return {
          docAncho: document.documentElement.scrollWidth,
          docAlto: document.documentElement.scrollHeight,
          ventanaAncho: window.innerWidth,
          ventanaAlto: window.innerHeight,
          mainSobra: main.scrollHeight - main.clientHeight,
        };
      });
      expect(medidas.docAncho).toBeLessThanOrEqual(medidas.ventanaAncho);
      expect(medidas.docAlto).toBeLessThanOrEqual(medidas.ventanaAlto);
      expect(medidas.mainSobra).toBeLessThanOrEqual(0);

      // El total y el botón Cobrar se ven completos.
      await expect(page.getByText('$ 0')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Cobrar' })).toBeInViewport({ ratio: 1 });

      const nav = await page.getByRole('navigation', { name: 'Secciones' }).boundingBox();
      const vp = page.viewportSize()!;
      if (info.project.name === 'pc') {
        // Barra lateral izquierda con el estado de conexión abajo.
        expect(nav!.x).toBe(0);
        expect(nav!.width).toBeLessThan(vp.width / 3);
        await expect(page.getByRole('navigation').getByText('En línea')).toBeVisible();
        await expect(page.getByText('Escaneá o escribí · F2')).toBeVisible();
      } else {
        // Barra abajo, de lado a lado.
        expect(Math.round(nav!.y + nav!.height)).toBe(vp.height);
        expect(nav!.width).toBe(vp.width);
        await expect(page.getByRole('button', { name: 'Escanear' })).toBeVisible();
      }
    });

    test('sin problemas de accesibilidad (axe)', async ({ page }) => {
      await abrirConTema(page, tema.id);
      const vender = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(vender.violations).toEqual([]);

      await page.getByRole('button', { name: 'Más' }).click();
      await page.getByRole('button', { name: /Apariencia/ }).click();
      await expect(page.getByRole('radiogroup', { name: 'Apariencia' })).toBeVisible();
      const apariencia = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(apariencia.violations).toEqual([]);
    });
  });
}

test('cambiar de tema se aplica al instante y queda guardado en el equipo', async ({ page }) => {
  await abrirConTema(page, 'noche');
  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: /Apariencia/ }).click();

  for (const tema of TEMAS) {
    await page.getByRole('radio', { name: new RegExp(`^${tema.nombre}`) }).check();
    await expect(page.locator('html')).toHaveAttribute('data-tema', tema.id);
    await expect(page.locator('body')).toHaveCSS('background-color', tema.fondo);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', tema.hex);
  }

  await page.getByRole('radio', { name: /^Pizarrón/ }).check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'pizarron');
});

test('el tema se aplica antes de pintar, sin pasar por el tema por defecto', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mostrador.tema', 'dia'));
  const temasVistos: string[] = [];
  await page.exposeFunction('registrarTema', (t: string) => temasVistos.push(t));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const t = document.documentElement.getAttribute('data-tema');
      // @ts-expect-error función expuesta por la prueba
      if (t) window.registrarTema(t);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-tema'] });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mi kiosco' })).toBeVisible();
  // El HTML trae "noche" de fábrica y tema.js lo cambia a "dia" antes del primer cuadro;
  // después de eso no tiene que volver a cambiar.
  expect(temasVistos.filter((t) => t !== 'dia')).toEqual([]);
});
