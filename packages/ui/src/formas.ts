// Formas SVG de la marca (sección 15 de docs/SPEC.md).

/** Polígono de estrella de `n` puntas. `inner` es el radio interior relativo (0 a 1). */
export function star(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  inner: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push(`${(cx + rx * r * Math.cos(a)).toFixed(1)},${(cy + ry * r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Borde en zigzag del ticket: dientes de ancho `t` y alto `h` a lo largo de `w`. */
export function zig(w: number, t: number, h: number): string {
  let d = 'M0 0';
  for (let x = 0; x < w; x += t) d += ` L${x + t / 2} ${h} L${x + t} 0`;
  return d + ' Z';
}

/** Rayas del toldo con borde festoneado. `even` elige las rayas pares o impares. */
export function awning(w: number, s: number, h: number, even: boolean): string {
  let d = '';
  for (let i = 0; i * s < w; i++) {
    if ((i % 2 === 0) !== even) continue;
    const x = i * s;
    d += `M${x} 0H${x + s}V${h}A${s / 2} ${s / 2} 0 0 1 ${x} ${h}Z`;
  }
  return d;
}
