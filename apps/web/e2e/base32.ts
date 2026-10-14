export function base32Decodificar(texto: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const salida: number[] = [];
  for (const ch of texto.trim()) {
    valor = (valor << 5) | alfabeto.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(salida);
}
