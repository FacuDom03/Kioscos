// TOTP (RFC 6238): códigos de 6 dígitos cada 30 segundos, HMAC-SHA1, compatible con
// Google Authenticator, Microsoft Authenticator y similares.
import { createHmac, randomBytes } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function nuevoSecretoTotp(): Buffer {
  return randomBytes(20);
}

export function codigoTotp(secreto: Buffer, ahoraMs = Date.now(), paso = 0): string {
  const contador = Math.floor(ahoraMs / 30_000) + paso;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', secreto).update(msg).digest();
  const offset = (h[h.length - 1] ?? 0) & 0x0f;
  const binario = h.readUInt32BE(offset) & 0x7fffffff;
  return String(binario % 1_000_000).padStart(6, '0');
}

/** Acepta el código actual y el de 30 segundos antes o después (relojes desfasados). */
export function verificarTotp(secreto: Buffer, codigo: string, ahoraMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(codigo)) return false;
  return [-1, 0, 1].some((p) => codigoTotp(secreto, ahoraMs, p) === codigo);
}

export function urlOtpauth(secreto: Buffer, cuenta: string, emisor: string): string {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  return `otpauth://totp/${etiqueta}?secret=${base32(secreto)}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}

/** Códigos de recuperación: 10 códigos de 10 caracteres, se muestran una sola vez. */
export function nuevosCodigosRecuperacion(): string[] {
  return Array.from({ length: 10 }, () => {
    const c = base32(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

export function normalizarCodigoRecuperacion(codigo: string): string {
  const limpio = codigo.toLowerCase().replace(/[^a-z2-7]/g, '');
  return `${limpio.slice(0, 5)}-${limpio.slice(5)}`;
}
