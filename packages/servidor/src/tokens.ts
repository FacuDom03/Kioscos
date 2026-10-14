import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatorio de 32 bytes en base64url (cookies, invitaciones, dispositivos). */
export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** En la base solo se guarda el hash del token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function igualesTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
