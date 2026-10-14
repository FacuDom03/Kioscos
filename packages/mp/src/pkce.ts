import { createHash, randomBytes } from 'node:crypto';

/** PKCE S256: verificador aleatorio de 64 caracteres y su desafío. */
export function nuevoPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString('base64url');
  return { verificador, desafio: desafioS256(verificador) };
}

export function desafioS256(verificador: string): string {
  return createHash('sha256').update(verificador).digest('base64url');
}
