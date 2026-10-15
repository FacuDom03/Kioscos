import { describe, expect, it } from 'vitest';
import { diaArgentino, sumarDias, diaCorto } from '../src/fechas.ts';
import {
  calcularPromos,
  importeDevuelto,
  importeDeDevolucion,
  promoVigente,
  reglaPromo,
  type ItemPromo,
  type Promo,
} from '../src/promos.ts';

const ESMALTES = 'g-esmaltes';
const MAQUILLAJE = 'c-maquillaje';

const tresPorDos: Promo = {
  id: 'p1',
  nombre: '3x2 en esmaltes',
  lleva: 3,
  paga: 2,
  descuento: 100,
  categoriaId: null,
  grupoId: ESMALTES,
  desde: null,
  hasta: null,
};
const segundaMitad: Promo = {
  id: 'p2',
  nombre: '2da al 50% en maquillaje',
  lleva: 2,
  paga: 1,
  descuento: 50,
  categoriaId: MAQUILLAJE,
  grupoId: null,
  desde: null,
  hasta: null,
};

const esmalte = (precioUnitario: number, cantidad = 1): ItemPromo => ({
  productoId: `e-${precioUnitario}`,
  cantidad,
  precioUnitario,
  categoriaId: MAQUILLAJE,
  grupoId: ESMALTES,
});
const labial = (precioUnitario: number, cantidad = 1): ItemPromo => ({
  productoId: `l-${precioUnitario}`,
  cantidad,
  precioUnitario,
  categoriaId: MAQUILLAJE,
  grupoId: null,
});

const HOY = '2026-10-15';

describe('calcularPromos', () => {
  it('3 esmaltes de tonos distintos: uno sale gratis', () => {
    const items = [esmalte(320000), { ...esmalte(320000), productoId: 'otro' }, esmalte(320000)];
    expect(calcularPromos(items, [tresPorDos], HOY)).toEqual([
      { promoId: 'p1', descripcion: '3x2 en esmaltes', monto: 320000, unidades: 1 },
    ]);
  });

  it('con precios distintos, el gratis es el más barato de cada grupo de tres', () => {
    const items = [esmalte(500000), esmalte(300000), esmalte(400000)];
    expect(calcularPromos(items, [tresPorDos], HOY)[0]?.monto).toBe(300000);
    // Seis unidades: van gratis la tercera y la sexta más caras.
    const seis = [600, 500, 400, 300, 200, 100].map((p) => esmalte(p));
    expect(calcularPromos(seis, [tresPorDos], HOY)[0]?.monto).toBe(400 + 100);
  });

  it('cuenta las unidades de un mismo renglón y deja afuera el grupo incompleto', () => {
    expect(calcularPromos([esmalte(1000, 4)], [tresPorDos], HOY)[0]).toMatchObject({
      monto: 1000,
      unidades: 1,
    });
    expect(calcularPromos([esmalte(1000, 7)], [tresPorDos], HOY)[0]?.unidades).toBe(2);
    expect(calcularPromos([esmalte(1000, 2)], [tresPorDos], HOY)).toEqual([]);
  });

  it('segunda unidad con descuento, redondeando al centavo', () => {
    expect(calcularPromos([labial(1000), labial(801)], [segundaMitad], HOY)[0]?.monto).toBe(401);
  });

  it('la promo del producto con variantes gana sobre la de la categoría', () => {
    const items = [esmalte(1000), esmalte(1000), esmalte(1000), labial(2000), labial(1000)];
    expect(calcularPromos(items, [segundaMitad, tresPorDos], HOY)).toEqual([
      { promoId: 'p1', descripcion: '3x2 en esmaltes', monto: 1000, unidades: 1 },
      { promoId: 'p2', descripcion: '2da al 50% en maquillaje', monto: 500, unidades: 1 },
    ]);
  });

  it('no aplica a cantidades con decimales, precio libre ni promos fuera de fecha', () => {
    expect(calcularPromos([esmalte(1000, 3.5)], [tresPorDos], HOY)).toEqual([]);
    expect(calcularPromos([{ ...esmalte(1000, 3), productoId: null }], [tresPorDos], HOY)).toEqual(
      [],
    );
    expect(
      calcularPromos([esmalte(1000, 3)], [{ ...tresPorDos, hasta: '2026-10-14' }], HOY),
    ).toEqual([]);
  });
});

describe('promoVigente y reglaPromo', () => {
  it('fechas inclusivas', () => {
    expect(promoVigente({ desde: HOY, hasta: HOY }, HOY)).toBe(true);
    expect(promoVigente({ desde: '2026-10-16', hasta: null }, HOY)).toBe(false);
  });
  it('nombra la regla', () => {
    expect(reglaPromo(tresPorDos)).toBe('3x2');
    expect(reglaPromo(segundaMitad)).toBe('2da con 50% menos');
    expect(reglaPromo({ lleva: 4, paga: 2, descuento: 30 })).toBe('Llevando 4, 2 con 30% menos');
  });
});

describe('importeDevuelto', () => {
  it('lo que se pagó, con su parte de la promo', () => {
    expect(
      importeDevuelto({ cantidad: 1, subtotal: 320000 }, 1, { suma: 960000, descuentos: 0 }),
    ).toBe(320000);
    // 3x2 de 3 esmaltes a $3.200: cada uno salió $2.133,33.
    expect(
      importeDevuelto({ cantidad: 1, subtotal: 320000 }, 1, { suma: 960000, descuentos: 320000 }),
    ).toBe(213333);
    expect(importeDevuelto({ cantidad: 4, subtotal: 4000 }, 1, { suma: 4000, descuentos: 0 })).toBe(
      1000,
    );
  });
});

describe('importeDeDevolucion', () => {
  it('devolviendo de a una, la suma no pasa de lo que se pagó', () => {
    const item = { cantidad: 2, subtotal: 1001 };
    const venta = { suma: 1001, descuentos: 0 };
    const primera = importeDeDevolucion(item, 0, 1, venta);
    const segunda = importeDeDevolucion(item, 1, 1, venta);
    expect(primera + segunda).toBe(1001);
  });
});

describe('fechas', () => {
  it('el día en la Argentina', () => {
    expect(diaArgentino('2026-10-15T02:00:00Z')).toBe('2026-10-14');
    expect(sumarDias('2026-12-31', 30)).toBe('2027-01-30');
    expect(diaCorto('2026-10-30')).toBe('30/10/2026');
  });
});
