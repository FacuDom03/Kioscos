// Turno de caja abierto en este equipo. Se guarda en el equipo para seguir vendiendo sin conexión.
import { uuidv7 } from '@mostrador/shared';
import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { encolar, eventosBandeja, opsPendientes } from './bandeja.ts';
import { borrarClave, guardarClave, leerClave } from './local.ts';

export interface Turno {
  id: string;
  cambioInicial: number;
  abiertoEn: string;
}

type Estado = { tipo: 'cargando' } | { tipo: 'cerrado' } | { tipo: 'abierto'; turno: Turno };

let estado: Estado = { tipo: 'cargando' };
let kiosco: string | null = null;
const oyentes = new Set<() => void>();
const fijar = (e: Estado) => {
  estado = e;
  for (const o of oyentes) o();
};

const clave = () => `turno:${kiosco}`;

export async function cargarTurno(kioscoId: string): Promise<void> {
  kiosco = kioscoId;
  const guardado = await leerClave<Turno>(clave());
  fijar(guardado ? { tipo: 'abierto', turno: guardado } : { tipo: 'cargando' });
  try {
    const r = await api<{ turno: { id: string; cambioInicial: number; abiertoEn: string } | null }>(
      'GET',
      '/api/v1/caja',
    );
    if (r.turno) {
      const t = {
        id: r.turno.id,
        cambioInicial: r.turno.cambioInicial,
        abiertoEn: r.turno.abiertoEn,
      };
      await guardarClave(clave(), t);
      fijar({ tipo: 'abierto', turno: t });
    } else {
      // Si la apertura de este equipo todavía no se subió, el turno sigue abierto acá.
      const pendiente =
        guardado &&
        (await opsPendientes()).some((o) => o.tipo === 'apertura' && o.id === guardado.id);
      if (pendiente && guardado) fijar({ tipo: 'abierto', turno: guardado });
      else {
        await borrarClave(clave());
        fijar({ tipo: 'cerrado' });
      }
    }
  } catch {
    // Sin conexión: vale lo guardado en el equipo.
    if (!guardado) fijar({ tipo: 'cerrado' });
  }
}

export async function abrirCaja(cambioInicial: number): Promise<void> {
  const t: Turno = { id: uuidv7(), cambioInicial, abiertoEn: new Date().toISOString() };
  await guardarClave(clave(), t);
  fijar({ tipo: 'abierto', turno: t });
  await encolar('apertura', { id: t.id, cambioInicial, abiertoEn: t.abiertoEn });
}

export async function olvidarTurno(): Promise<void> {
  if (kiosco) await borrarClave(clave());
  fijar({ tipo: 'cerrado' });
}

eventosBandeja.addEventListener('turno', (ev) => {
  const id = (ev as CustomEvent<string>).detail;
  if (estado.tipo === 'abierto' && estado.turno.id !== id) {
    const t = { ...estado.turno, id };
    void guardarClave(clave(), t);
    fijar({ tipo: 'abierto', turno: t });
  }
});

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useTurno = () => useSyncExternalStore(suscribir, () => estado);
export const turnoActual = () => (estado.tipo === 'abierto' ? estado.turno : null);
