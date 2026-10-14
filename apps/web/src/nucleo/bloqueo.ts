// Bloqueo de pantalla por inactividad del cajero. Se destraba con el PIN contra un hash local
// (PBKDF2 con WebCrypto). Es solo un bloqueo de pantalla: no autentica contra el servidor.
import { guardarClave, leerClave } from './local.ts';

interface HashPin {
  sal: string;
  hash: string;
  iteraciones: number;
}

const ITERACIONES = 200_000;
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));

async function derivar(pin: string, sal: Uint8Array, iteraciones: number): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones },
    clave,
    256,
  );
  return b64(bits);
}

export async function guardarPinLocal(kioscoId: string, pin: string): Promise<void> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  await guardarClave(`pin:${kioscoId}`, {
    sal: b64(sal),
    hash: await derivar(pin, sal, ITERACIONES),
    iteraciones: ITERACIONES,
  } satisfies HashPin);
}

export async function verificarPinLocal(kioscoId: string, pin: string): Promise<boolean> {
  const h = await leerClave<HashPin>(`pin:${kioscoId}`);
  if (!h) return false;
  const sal = Uint8Array.from(atob(h.sal), (c) => c.charCodeAt(0));
  return (await derivar(pin, sal, h.iteraciones)) === h.hash;
}

export async function hayPinLocal(kioscoId: string): Promise<boolean> {
  return !!(await leerClave<HashPin>(`pin:${kioscoId}`));
}
