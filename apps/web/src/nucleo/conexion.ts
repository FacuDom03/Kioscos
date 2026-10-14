// ¿Hay conexión con el servidor? Combina el estado del navegador con el resultado de los pedidos.
import { useSyncExternalStore } from 'react';
import { eventosConexion } from './api.ts';

let enLinea = typeof navigator === 'undefined' ? true : navigator.onLine;
const oyentes = new Set<() => void>();
const fijar = (v: boolean) => {
  if (v === enLinea) return;
  enLinea = v;
  for (const o of oyentes) o();
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => fijar(true));
  window.addEventListener('offline', () => fijar(false));
  eventosConexion.addEventListener('conexion', (e) =>
    fijar((e as CustomEvent<boolean>).detail && navigator.onLine),
  );
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};

export const useEnLinea = () => useSyncExternalStore(suscribir, () => enLinea);
export const estaEnLinea = () => enLinea;
