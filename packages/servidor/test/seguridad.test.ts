import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  codigoTotp,
  crearCifrador,
  hashPassword,
  normalizarCodigoRecuperacion,
  nuevosCodigosRecuperacion,
  verificarPassword,
  verificarTotp,
} from '../src/index.ts';

describe('TOTP (RFC 6238)', () => {
  // Vector de prueba del RFC 6238 (SHA1, secreto "12345678901234567890").
  const secreto = Buffer.from('12345678901234567890');
  it('coincide con los vectores del RFC', () => {
    expect(codigoTotp(secreto, 59_000)).toBe('287082');
    expect(codigoTotp(secreto, 1_111_111_109_000)).toBe('081804');
    expect(codigoTotp(secreto, 2_000_000_000_000)).toBe('279037');
  });
  it('acepta 30 segundos de desfase y no más', () => {
    const t = 1_700_000_000_000;
    expect(verificarTotp(secreto, codigoTotp(secreto, t - 30_000), t)).toBe(true);
    expect(verificarTotp(secreto, codigoTotp(secreto, t - 90_000), t)).toBe(false);
    expect(verificarTotp(secreto, 'abcdef', t)).toBe(false);
  });
});

describe('códigos de recuperación', () => {
  it('son 10 distintos y se normalizan', () => {
    const c = nuevosCodigosRecuperacion();
    expect(new Set(c).size).toBe(10);
    expect(normalizarCodigoRecuperacion(c[0]!.toUpperCase().replace('-', ' '))).toBe(c[0]);
  });
});

describe('contraseñas', () => {
  it('Argon2id verifica la buena y rechaza la mala', async () => {
    const h = await hashPassword('una contraseña larga');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verificarPassword(h, 'una contraseña larga')).toBe(true);
    expect(await verificarPassword(h, 'otra')).toBe(false);
    expect(await verificarPassword(null, 'otra')).toBe(false);
  });
});

describe('cifrado', () => {
  it('cifra, descifra y rota claves', async () => {
    const k1 = randomBytes(32).toString('base64');
    const k2 = randomBytes(32).toString('base64');
    const viejo = await crearCifrador({ 1: k1 }, 1);
    const c = viejo.cifrar('token-secreto');
    const nuevo = await crearCifrador({ 1: k1, 2: k2 }, 2);
    expect(nuevo.descifrar(c.datos, c.version).toString()).toBe('token-secreto');
    expect(nuevo.cifrar('x').version).toBe(2);
  });
  it('detecta datos alterados', async () => {
    const cif = await crearCifrador({ 1: randomBytes(32).toString('base64') }, 1);
    const c = cif.cifrar('token');
    c.datos[c.datos.length - 1]! ^= 1;
    expect(() => cif.descifrar(c.datos, c.version)).toThrow();
  });
});
