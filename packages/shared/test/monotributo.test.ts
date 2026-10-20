import { describe, expect, it } from 'vitest';
import { categoriaPara, recategorizacion, topesVigentes } from '../src/monotributo.ts';

describe('monotributo', () => {
  it('topes vigentes y categoría que alcanza', () => {
    expect(topesVigentes('2026-10-20').D).toBe(3_062_865_100);
    expect(categoriaPara(0, '2026-10-20')).toBe('A');
    expect(categoriaPara(1_200_941_000, '2026-10-20')).toBe('A');
    expect(categoriaPara(1_200_941_001, '2026-10-20')).toBe('B');
    expect(categoriaPara(12_661_083_901, '2026-10-20')).toBeNull();
  });

  it('época de recategorización', () => {
    expect(recategorizacion('2026-10-20')).toBeNull();
    expect(recategorizacion('2027-01-15')).toEqual({
      hasta: '2027-02-05',
      desde: '2026-01-01',
      hastaPeriodo: '2026-12-31',
    });
    expect(recategorizacion('2027-02-05')).not.toBeNull();
    expect(recategorizacion('2027-02-06')).toBeNull();
    expect(recategorizacion('2027-08-03')).toEqual({
      hasta: '2027-08-05',
      desde: '2026-07-01',
      hastaPeriodo: '2027-06-30',
    });
  });
});
