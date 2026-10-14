import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contraste, leerTemas, verificar } from '../scripts/contraste.ts';
import { TEMAS } from '../src/temas.ts';

const css = readFileSync(new URL('../src/temas.css', import.meta.url), 'utf8');

describe('contraste de tokens', () => {
  it('calcula la relación de contraste de WCAG', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#777777', '#777777')).toBe(1);
  });

  it('el CSS define los cuatro temas de la app', () => {
    expect(Object.keys(leerTemas(css)).sort()).toEqual(TEMAS.map((t) => t.id).sort());
  });

  it('todos los pares pasan', () => {
    expect(verificar(leerTemas(css)).filter((r) => !r.pasa)).toEqual([]);
  });

  it('detecta un par que no pasa', () => {
    const roto = css.replace(/--star-ink: #0b1229;/i, '--star-ink: #C0B000;');
    expect(verificar(leerTemas(roto)).some((r) => !r.pasa && r.par.includes('star-ink'))).toBe(
      true,
    );
  });

  it('el theme-color de cada tema coincide con su --bg', () => {
    const temas = leerTemas(css);
    for (const t of TEMAS)
      expect(temas[t.id]!['bg']!.toUpperCase()).toBe(t.themeColor.toUpperCase());
  });
});
