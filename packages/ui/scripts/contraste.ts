// Verifica los contrastes de los tokens de todos los temas (sección 16.3 de docs/SPEC.md).
// Corre en CI: `pnpm contraste`. Sale con código 1 si algún par no llega al mínimo.
import { readFileSync } from 'node:fs';

type Tokens = Record<string, string>;

export interface Par {
  frente: string;
  fondo: string;
  minimo: number;
  uso: string;
}

// Texto: 4,5:1 · Total del cartel: 7:1 · Bordes de controles, foco y series: 3:1.
export const PARES: Par[] = [
  { frente: 'text', fondo: 'bg', minimo: 4.5, uso: 'texto' },
  { frente: 'text', fondo: 'surface', minimo: 4.5, uso: 'texto' },
  { frente: 'text', fondo: 'surface-2', minimo: 4.5, uso: 'texto' },
  { frente: 'text-soft', fondo: 'bg', minimo: 4.5, uso: 'texto secundario' },
  { frente: 'text-soft', fondo: 'surface', minimo: 4.5, uso: 'texto secundario' },
  { frente: 'text', fondo: 'nav-bg', minimo: 4.5, uso: 'barra activa' },
  { frente: 'text-soft', fondo: 'nav-bg', minimo: 4.5, uso: 'barra inactiva' },
  { frente: 'ok', fondo: 'bg', minimo: 4.5, uso: 'estado bien' },
  { frente: 'ok', fondo: 'surface', minimo: 4.5, uso: 'estado bien' },
  { frente: 'danger', fondo: 'bg', minimo: 4.5, uso: 'estado problema' },
  { frente: 'danger', fondo: 'surface', minimo: 4.5, uso: 'estado problema' },
  { frente: 'scan-ink', fondo: 'scan-bg', minimo: 4.5, uso: 'botón Escanear' },
  { frente: 'action-ink', fondo: 'action', minimo: 4.5, uso: 'botón principal' },
  { frente: 'paper-ink', fondo: 'paper', minimo: 4.5, uso: 'ticket' },
  { frente: 'paper-soft', fondo: 'paper', minimo: 4.5, uso: 'ticket secundario' },
  { frente: 'qty-ink', fondo: 'qty-bg', minimo: 4.5, uso: 'cantidad del ticket' },
  { frente: 'star-ink', fondo: 'star', minimo: 7, uso: 'total del cartel (AAA)' },
  { frente: 'stamp', fondo: 'paper', minimo: 3, uso: 'sello PAGADO (texto grande)' },
  { frente: 'line-control', fondo: 'bg', minimo: 3, uso: 'borde de control' },
  { frente: 'line-control', fondo: 'surface', minimo: 3, uso: 'borde de control' },
  { frente: 'focus', fondo: 'bg', minimo: 3, uso: 'anillo de foco' },
  { frente: 'focus', fondo: 'surface', minimo: 3, uso: 'anillo de foco' },
  { frente: 'danger-dot', fondo: 'surface', minimo: 3, uso: 'punto de aviso' },
  { frente: 'chart-1', fondo: 'surface', minimo: 3, uso: 'serie del gráfico' },
  { frente: 'chart-2', fondo: 'surface', minimo: 3, uso: 'serie del gráfico' },
  { frente: 'chart-3', fondo: 'surface', minimo: 3, uso: 'serie del gráfico' },
];

export function leerTemas(css: string): Record<string, Tokens> {
  const temas: Record<string, Tokens> = {};
  for (const bloque of css.matchAll(/\[data-tema=["'](\w+)["']\]\s*\{([^}]*)\}/g)) {
    const tokens: Tokens = {};
    for (const [, nombre, valor] of bloque[2]!.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      tokens[nombre!] = valor!.trim();
    }
    temas[bloque[1]!] = tokens;
  }
  return temas;
}

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (oscuro + 0.05);
}

const esHex = (v: string | undefined): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v);

export interface Resultado {
  tema: string;
  par: string;
  valor: number;
  minimo: number;
  uso: string;
  pasa: boolean;
}

export function verificar(temas: Record<string, Tokens>): Resultado[] {
  const resultados: Resultado[] = [];
  for (const [tema, t] of Object.entries(temas)) {
    const pares = [...PARES];
    // El precio del mosaico va sobre --price-bg si el tema lo tiene, si no sobre --surface.
    pares.push({
      frente: 'price-ink',
      fondo: esHex(t['price-bg']) ? 'price-bg' : 'surface',
      minimo: 4.5,
      uso: 'precio del mosaico',
    });
    for (const p of pares) {
      const frente = t[p.frente];
      const fondo = t[p.fondo];
      if (!esHex(frente) || !esHex(fondo)) {
        throw new Error(`Tema ${tema}: falta --${p.frente} o --${p.fondo} (o no es #RRGGBB)`);
      }
      const valor = contraste(frente, fondo);
      resultados.push({
        tema,
        par: `--${p.frente} sobre --${p.fondo}`,
        valor,
        minimo: p.minimo,
        uso: p.uso,
        pasa: valor >= p.minimo,
      });
    }
  }
  return resultados;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const css = readFileSync(new URL('../src/temas.css', import.meta.url), 'utf8');
  const temas = leerTemas(css);
  const esperados = ['noche', 'dia', 'pizarron', 'contraste', 'sobrio', 'grafito', 'boutique'];
  const faltan = esperados.filter((t) => !temas[t]);
  if (faltan.length) {
    console.error(`Faltan temas: ${faltan.join(', ')}`);
    process.exit(1);
  }
  const resultados = verificar(temas);
  const fallas = resultados.filter((r) => !r.pasa);
  for (const r of fallas) {
    console.error(
      `✗ ${r.tema}: ${r.par} = ${r.valor.toFixed(2)}:1 (mínimo ${r.minimo}:1, ${r.uso})`,
    );
  }
  console.log(`${resultados.length - fallas.length}/${resultados.length} pares pasan`);
  process.exit(fallas.length ? 1 : 0);
}
