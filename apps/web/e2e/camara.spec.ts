import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entrar, kioscoConDueno, productos } from './ayuda.ts';

const CODIGO = '7790895000997';

// Barras de un EAN-13: cada dígito son 7 módulos (1 = barra negra).
const IZQ = '0001101 0011001 0010011 0111101 0100011 0110001 0101111 0111011 0110111 0001011'.split(
  ' ',
);
const PARIDAD = 'LLLLLL LLGLGG LLGGLG LLGGGL LGLLGG LGGLLG LGGGLL LGLGLG LGLGGL LGGLGL'.split(' ');
const der = (d: number) => [...IZQ[d]!].map((b) => (b === '1' ? '0' : '1')).join('');

function barrasEan13(codigo: string): string {
  const d = [...codigo].map(Number);
  const paridad = PARIDAD[d[0]!]!;
  const izquierda = d
    .slice(1, 7)
    .map((n, i) => (paridad[i] === 'L' ? IZQ[n]! : [...der(n)].reverse().join('')))
    .join('');
  return `101${izquierda}01010${d.slice(7).map(der).join('')}101`;
}

/**
 * Video para la cámara falsa de Chromium (formato y4m): un código de barras de 180 px de alto,
 * centrado a lo ancho y desde la altura `arriba`, en un cuadro de 1280×960. Con esa resolución
 * el escáner muestra la imagen al doble.
 */
function videoConCodigo(codigo: string, arriba: number): string {
  const ancho = 1280;
  const alto = 960;
  const modulo = 4;
  const barras = barrasEan13(codigo);
  const x0 = (ancho - barras.length * modulo) / 2;
  const luz = Buffer.alloc(ancho * alto, 255);
  for (let y = arriba; y < arriba + 180; y++) {
    for (let i = 0; i < barras.length; i++) {
      if (barras[i] === '1')
        luz.fill(0, y * ancho + x0 + i * modulo, y * ancho + x0 + (i + 1) * modulo);
    }
  }
  const color = Buffer.alloc((ancho / 2) * (alto / 2) * 2, 128);
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), luz, color]);
  const archivo = join(tmpdir(), `mostrador-camara-${arriba}-${process.pid}.y4m`);
  writeFileSync(
    archivo,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F10:1 Ip A1:1 C420jpeg\n`),
      cuadro,
      cuadro,
    ]),
  );
  return archivo;
}

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${videoConCodigo(CODIGO, 390)}`,
    ],
  },
});

test('la cámara lee el código dentro del marco y lo suma al ticket', async ({ page }, info) => {
  test.skip(info.project.name === 'pc', 'En la computadora se usa el lector, no la cámara.');
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [{ nombre: 'Coca-Cola 500 ml', precio: 180000, codigo: CODIGO }]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('.mosaico', { hasText: 'Coca-Cola' })).toBeVisible();

  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByRole('button', { name: 'Abrir la cámara' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Escanear' });
  await expect(dialogo.getByText('Mantené unos 15 cm de distancia')).toBeVisible();
  await expect(dialogo.locator('video')).toHaveClass(/escaner__video--agrandado/);
  await expect(dialogo.getByRole('status')).toHaveText(`Último código leído: ${CODIGO}`);
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);

  await dialogo.getByRole('button', { name: 'Listo' }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(/^Ticket · \d+ productos?$/)).toBeVisible();
});

test('en Stock, escanear muestra el precio y el stock de ese producto', async ({ page }, info) => {
  test.skip(info.project.name === 'pc', 'En la computadora se usa el lector, no la cámara.');
  const d = await kioscoConDueno();
  await productos(d.kioscoId, [
    { nombre: 'Coca-Cola 500 ml', precio: 180000, codigo: CODIGO, stock: 7 },
    { nombre: 'Alfajor de maicena', precio: 90000, codigo: '7790000000016' },
  ]);
  await entrar(page, d);
  await page.goto('/');
  await expect(page.locator('.mosaico', { hasText: 'Coca-Cola' })).toBeVisible();
  await page.goto('/stock');
  await expect(page.getByText('Alfajor de maicena')).toBeVisible();

  await page.getByRole('button', { name: 'Escanear' }).click();
  await page.getByRole('button', { name: 'Abrir la cámara' }).click();
  await expect(page.getByRole('dialog', { name: 'Escanear' })).toBeHidden();
  await expect(page.getByLabel('Buscar producto')).toHaveValue(CODIGO);
  await expect(page.getByText('Coca-Cola 500 ml')).toBeVisible();
  await expect(page.getByText('7 en stock')).toBeVisible();
  await expect(page.getByText('Alfajor de maicena')).toBeHidden();
});
