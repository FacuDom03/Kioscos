import { describe, expect, it } from 'vitest';
import { buscar, indexar } from '../src/busqueda.ts';

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
