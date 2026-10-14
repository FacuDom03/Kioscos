import { hash, verify } from '@node-rs/argon2';

// Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 pasadas).
const OPCIONES = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// Hash de una contraseña al azar: se verifica contra él cuando el email no existe, así la
// respuesta tarda lo mismo y no se puede averiguar qué emails tienen cuenta.
let hashFicticio: Promise<string> | undefined;

export function hashPassword(texto: string): Promise<string> {
  return hash(texto, OPCIONES);
}

export async function verificarPassword(
  hashGuardado: string | null,
  texto: string,
): Promise<boolean> {
  if (!hashGuardado) {
    hashFicticio ??= hash('contraseña-que-no-existe', OPCIONES);
    await verify(await hashFicticio, texto).catch(() => false);
    return false;
  }
  try {
    return await verify(hashGuardado, texto);
  } catch {
    return false;
  }
}
