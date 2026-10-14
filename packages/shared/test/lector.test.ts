import { describe, expect, it } from 'vitest';
import { DetectorRafagas } from '../src/lector.ts';

function teclear(
  d: DetectorRafagas,
  texto: string,
  inicio: number,
  paso: number,
): (string | null)[] {
  const salidas: (string | null)[] = [];
  let t = inicio;
  for (const c of texto) {
    salidas.push(d.tecla(c, t));
    t += paso;
  }
  salidas.push(d.tecla('Enter', t));
  return salidas;
}

describe('DetectorRafagas', () => {
  it('reconoce un lector: 13 dígitos a 10 ms y Enter', () => {
    const d = new DetectorRafagas();
    expect(teclear(d, '7790895000997', 1000, 10).at(-1)).toBe('7790895000997');
  });

  it('ignora a una persona escribiendo (más de 35 ms entre teclas)', () => {
    const d = new DetectorRafagas();
    expect(teclear(d, '7790895000997', 1000, 120).at(-1)).toBeNull();
  });

  it('ignora ráfagas cortas', () => {
    const d = new DetectorRafagas();
    expect(teclear(d, '12345', 1000, 5).at(-1)).toBeNull();
  });

  it('si una persona escribió antes, la ráfaga del lector igual se reconoce', () => {
    const d = new DetectorRafagas();
    d.tecla('h', 0);
    d.tecla('o', 300);
    expect(teclear(d, 'ABC-123456', 1000, 8).at(-1)).toBe('ABC-123456');
  });

  it('una tecla especial en el medio corta la ráfaga', () => {
    const d = new DetectorRafagas();
    for (const [i, c] of [...'779089'].entries()) d.tecla(c, i * 5);
    d.tecla('Shift', 31);
    expect(d.tecla('Enter', 35)).toBeNull();
  });

  it('Enter que llega mucho después no cuenta como lector', () => {
    const d = new DetectorRafagas();
    for (const [i, c] of [...'7790895000997'].entries()) d.tecla(c, i * 5);
    expect(d.tecla('Enter', 5000)).toBeNull();
  });
});
