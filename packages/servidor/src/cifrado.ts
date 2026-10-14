// Cifrado de secretos (tokens de Mercado Pago, secretos TOTP) con libsodium crypto_secretbox.
// La clave maestra vive en un archivo de secretos del servidor, fuera de la base y del repo.
// Se guarda la versión de la clave junto al dato para poder rotarla.
import sodium from 'libsodium-wrappers';

export interface Cifrador {
  versionActual: number;
  cifrar(texto: Uint8Array | string): { datos: Buffer; version: number };
  descifrar(datos: Uint8Array, version: number): Buffer;
}

export async function crearCifrador(
  claves: Record<number, string>,
  actual: number,
): Promise<Cifrador> {
  await sodium.ready;
  const binarias = new Map<number, Uint8Array>();
  for (const [v, k] of Object.entries(claves)) {
    const bytes = Buffer.from(k, 'base64');
    if (bytes.length !== sodium.crypto_secretbox_KEYBYTES) {
      throw new Error(`La clave ${v} no mide ${sodium.crypto_secretbox_KEYBYTES} bytes`);
    }
    binarias.set(Number(v), new Uint8Array(bytes));
  }
  const clave = (v: number) => {
    const k = binarias.get(v);
    if (!k) throw new Error(`No existe la clave de cifrado versión ${v}`);
    return k;
  };

  return {
    versionActual: actual,
    cifrar(texto) {
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const caja = sodium.crypto_secretbox_easy(texto, nonce, clave(actual));
      return { datos: Buffer.concat([nonce, caja]), version: actual };
    },
    descifrar(datos, version) {
      const n = sodium.crypto_secretbox_NONCEBYTES;
      const abierto = sodium.crypto_secretbox_open_easy(
        datos.subarray(n),
        datos.subarray(0, n),
        clave(version),
      );
      return Buffer.from(abierto);
    },
  };
}
