// UUIDv7 (RFC 9562): 48 bits de milisegundos Unix + versión + 74 bits aleatorios.
// Se genera en la app (y en el dispositivo, para las ventas sin conexión).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

let ultimoMs = -1;
let secuencia = 0;

export function uuidv7(ahora: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  // Monotonía dentro del mismo milisegundo: los 12 bits de rand_a se usan como contador
  // para que dos IDs generados seguidos queden ordenados.
  let ms = ahora;
  if (ms <= ultimoMs) {
    ms = ultimoMs;
    secuencia++;
    if (secuencia > 0xfff) {
      ms++;
      secuencia = 0;
    }
  } else {
    secuencia = ((bytes[6] ?? 0) << 4) & 0x7ff; // arranca en la mitad baja para dejar lugar
  }
  ultimoMs = ms;

  const msBig = BigInt(ms);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((msBig >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = 0x70 | ((secuencia >> 8) & 0x0f);
  bytes[7] = secuencia & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
