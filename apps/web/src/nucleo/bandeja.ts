// Bandeja de salida: ventas, gastos y aperturas se guardan primero en el equipo y se suben
// solas. Cada operación tiene su UUID: reenviarla nunca duplica nada (sección 12).
import { useSyncExternalStore } from 'react';
import { api, ErrorApi } from './api.ts';
import { local, type OpPendiente, type TipoOp } from './local.ts';

export interface AvisoStock {
  productoId: string;
  nombre: string;
  stock: number;
}

interface Resultado {
  id: string;
  estado: 'ok' | 'ya_existia' | 'rechazada';
  mensaje?: string;
  avisos?: AvisoStock[];
  turnoId?: string;
}

interface Estado {
  pendientes: number;
  rechazadas: number;
  subiendo: boolean;
  ultimaSubida: string | null;
  /** Última tanda que se subió después de estar sin conexión. */
  subidasRecientes: number;
}

let estado: Estado = {
  pendientes: 0,
  rechazadas: 0,
  subiendo: false,
  ultimaSubida: null,
  subidasRecientes: 0,
};
const oyentes = new Set<() => void>();
const emitir = (cambio: Partial<Estado>) => {
  estado = { ...estado, ...cambio };
  for (const o of oyentes) o();
};

export const eventosBandeja = new EventTarget();

let kioscoActual: string | null = null;

async function contar() {
  if (!kioscoActual) return emitir({ pendientes: 0, rechazadas: 0 });
  const ops = await local.bandeja
    .where('kioscoId')
    .equals(kioscoActual)
    .toArray()
    .catch(() => [] as OpPendiente[]);
  emitir({
    pendientes: ops.filter((o) => o.estado === 'pendiente').length,
    rechazadas: ops.filter((o) => o.estado === 'rechazada').length,
  });
}

export function usarKiosco(kioscoId: string | null): void {
  kioscoActual = kioscoId;
  void contar();
}

export async function encolar(tipo: TipoOp, datos: OpPendiente['datos']): Promise<void> {
  if (!kioscoActual) throw new Error('Sin kiosco');
  await local.bandeja.put({
    id: datos.id,
    kioscoId: kioscoActual,
    tipo,
    datos,
    creadaEn: new Date().toISOString(),
    estado: 'pendiente',
    intentos: 0,
  });
  await contar();
  void sincronizar();
}

let espera = 2_000;
let temporizador: ReturnType<typeof setTimeout> | undefined;
let enCurso: Promise<boolean> | null = null;

/** Sube lo pendiente. Devuelve true si no quedó nada pendiente. */
export function sincronizar(): Promise<boolean> {
  enCurso ??= subir().finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function subir(): Promise<boolean> {
  const kiosco = kioscoActual;
  if (!kiosco) return true;
  const ops = (await local.bandeja.where('kioscoId').equals(kiosco).toArray())
    .filter((o) => o.estado === 'pendiente')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!ops.length) return true;
  const eraSinConexion = estado.pendientes > 0 && !navigator.onLine;
  emitir({ subiendo: true });
  try {
    let subidas = 0;
    for (let i = 0; i < ops.length; i += 100) {
      const lote = ops.slice(i, i + 100);
      const r = await api<{ resultados: Resultado[] }>('POST', '/api/v1/sync', {
        ops: lote.map((o) => ({ tipo: o.tipo, datos: o.datos })),
      });
      for (const res of r.resultados) {
        if (res.estado === 'rechazada') {
          await local.bandeja.update(res.id, {
            estado: 'rechazada',
            mensaje: res.mensaje ?? 'No se pudo guardar.',
          });
          continue;
        }
        const op = lote.find((o) => o.id === res.id);
        await local.bandeja.delete(res.id);
        subidas++;
        if (op?.tipo === 'venta' || op?.tipo === 'gasto')
          eventosBandeja.dispatchEvent(new CustomEvent('subida', { detail: op }));
        if (res.avisos?.length)
          eventosBandeja.dispatchEvent(new CustomEvent('stock-negativo', { detail: res.avisos }));
        // Otro equipo ya había abierto la caja: lo pendiente pasa a ese turno.
        if (op?.tipo === 'apertura' && res.turnoId && res.turnoId !== op.id) {
          await reasignarTurno(kiosco, op.id, res.turnoId);
        }
        if (op?.tipo === 'apertura' && res.turnoId)
          eventosBandeja.dispatchEvent(new CustomEvent('turno', { detail: res.turnoId }));
      }
    }
    espera = 2_000;
    emitir({
      ultimaSubida: new Date().toISOString(),
      subidasRecientes: eraSinConexion || subidas > 1 ? subidas : 0,
    });
    await contar();
    return estado.pendientes === 0;
  } catch (e) {
    // Sin conexión o error del servidor: reintenta con espera creciente.
    if (!(e instanceof ErrorApi) || e.status === 0 || e.status >= 500 || e.status === 429) {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => void sincronizar(), espera);
      espera = Math.min(espera * 2, 60_000);
    }
    return false;
  } finally {
    emitir({ subiendo: false });
  }
}

async function reasignarTurno(kiosco: string, viejo: string, nuevo: string) {
  const ops = await local.bandeja.where('kioscoId').equals(kiosco).toArray();
  for (const o of ops) {
    if (o.datos['turnoId'] === viejo)
      await local.bandeja.update(o.id, { datos: { ...o.datos, turnoId: nuevo } });
  }
}

export async function opsPendientes(): Promise<OpPendiente[]> {
  if (!kioscoActual) return [];
  return local.bandeja.where('kioscoId').equals(kioscoActual).toArray();
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};

export function useBandeja(): Estado {
  return useSyncExternalStore(suscribir, () => estado);
}

export function hayPendientes(): boolean {
  return estado.pendientes > 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void sincronizar());
}
