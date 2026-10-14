import { describe, expect, it } from 'vitest';
import { esUuid, uuidv7 } from '../src/uuid.ts';

describe('uuidv7', () => {
  it('tiene formato, versión 7 y variante RFC', () => {
    const id = uuidv7();
    expect(esUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('codifica el milisegundo en los primeros 48 bits', () => {
    // Una fecha lejana: uuidv7 nunca retrocede, así que tiene que ser posterior al reloj real.
    const ms = Date.UTC(2099, 9, 14, 12, 0, 0);
    const id = uuidv7(ms);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
  });

  it('es ordenable aunque se generen muchos en el mismo milisegundo', () => {
    const ms = Date.UTC(2030, 0, 1);
    const ids = Array.from({ length: 5000 }, () => uuidv7(ms));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no retrocede si el reloj va para atrás', () => {
    const a = uuidv7(Date.UTC(2031, 0, 1));
    const b = uuidv7(Date.UTC(2020, 0, 1));
    expect(b > a).toBe(true);
  });
});
