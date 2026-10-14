import { useSyncExternalStore } from 'react';
import { api } from './api.ts';

export interface EstadoMp {
  configurado: boolean;
  estado: 'conectado' | 'requiere_atencion' | 'desconectado';
  puedeCobrar: boolean;
}

let estado: EstadoMp | null = null;
const oyentes = new Set<() => void>();

export async function refrescarMp(): Promise<void> {
  try {
    estado = await api<EstadoMp>('GET', '/api/v1/mp/estado');
  } catch {
    // Sin conexión: queda lo último que se supo.
  }
  for (const o of oyentes) o();
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useEstadoMp = () => useSyncExternalStore(suscribir, () => estado);
