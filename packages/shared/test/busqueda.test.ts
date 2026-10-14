import { describe, expect, it } from 'vitest';
import { buscar, indexar, normalizar } from '../src/busqueda.ts';

const productos = [
  { id: '1', nombre: 'Coca-Cola 500 ml', codigos: ['7790895000997'] },
  { id: '2', nombre: 'Alfajor Jorgito', codigos: [] },
  { id: '3', nombre: 'Agua sin gas', codigos: ['7798062540017'] },
  { id: '4', nombre: 'Pepsi Cola', codigos: [] },
];

describe('buscar', () => {
  const i = indexar(productos);
  it('encuentra por código exacto', () => {
    expect(buscar(i, '7790895000997').map((p) => p.id)).toEqual(['1']);
  });
  it('encuentra por palabras sin importar tildes ni mayúsculas', () => {
    expect(buscar(i, 'COLA').map((p) => p.id)).toEqual(['1', '4']);
    expect(buscar(i, 'alfajór').map((p) => p.id)).toEqual(['2']);
    expect(buscar(i, 'cola pep').map((p) => p.id)).toEqual(['4']);
  });
  it('prioriza los que empiezan con la palabra', () => {
    expect(buscar(i, 'cola').map((p) => p.id)[0]).toBe('1');
    expect(
      buscar(i, 'a')
        .map((p) => p.id)
        .slice(0, 2),
    ).toEqual(['2', '3']);
  });
  it('busca en menos de 100 ms con 5000 productos', () => {
    const muchos = Array.from({ length: 5000 }, (_, n) => ({
      id: String(n),
      nombre: `Producto número ${n} sabor ${n % 37}`,
      codigos: [`779${String(n).padStart(10, '0')}`],
    }));
    const indice = indexar(muchos);
    const t = performance.now();
    for (let k = 0; k < 10; k++) buscar(indice, `sabor ${k}`);
    expect((performance.now() - t) / 10).toBeLessThan(100);
  });
});

describe('medidas y códigos propios', () => {
  const ferreteria = indexar([
    { id: 'c', nombre: 'Cable unipolar 2.5mm² rojo', codigos: ['ELE-0125'] },
    { id: 'k', nombre: 'Caño 1/2 pulgada', codigos: ['7790000000017'] },
    { id: 'm', nombre: 'Mecha 2½ widia', codigos: [] },
    { id: 't', nombre: 'Tornillo 6x1', codigos: [] },
  ]);
  const ids = (q: string) => buscar(ferreteria, q).map((p) => p.id);

  it('2,5, 2.5 y 2½ son la misma medida', () => {
    expect(normalizar('2,5')).toBe('2.5');
    expect(normalizar('2½')).toBe('2.5');
    expect(normalizar('Cable 2.5mm²')).toBe('cable 2.5 mm');
    expect(ids('cable 2,5')).toEqual(['c']);
    expect(ids('2,5')).toEqual(['c', 'm']);
    expect(ids('2,5 mm')).toEqual(['c']);
    expect(ids('mecha 2.5')).toEqual(['m']);
  });

  it('las fracciones se buscan escritas de cualquier forma', () => {
    expect(ids('caño ½')).toEqual(['k']);
    expect(ids('cano 1/2')).toEqual(['k']);
  });

  it('letras y números pegados se separan', () => {
    expect(ids('tornillo 6 x 1')).toEqual(['t']);
    expect(ids('6x1')).toEqual(['t']);
  });

  it('busca por partes del código propio, no de los códigos de barras', () => {
    expect(ids('ele-01')).toEqual(['c']);
    expect(ids('7790000')).toEqual([]);
    expect(ids('7790000000017')).toEqual(['k']);
  });
});
