// Actualizaciones de la app: nunca se recarga sola con un ticket abierto. Se avisa "Hay una
// versión nueva" y se aplica al tocar o al cerrar la caja (sección 12).
import { useSyncExternalStore } from 'react';
import { ticketActual } from './ticket.ts';

let hayNueva = false;
let aplicar: ((recargar?: boolean) => Promise<void>) | null = null;
const oyentes = new Set<() => void>();

export async function registrarServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const { registerSW } = await import('virtual:pwa-register');
  aplicar = registerSW({
    immediate: true,
    onNeedRefresh() {
      hayNueva = true;
      for (const o of oyentes) o();
    },
  });
}

/** Aplica la versión nueva si no hay ticket en curso. Devuelve false si no pudo. */
export async function aplicarActualizacion(): Promise<boolean> {
  if (!hayNueva || !aplicar || ticketActual().length > 0) return false;
  // Cuando la versión nueva toma el control, se recarga la página. Si el navegador la había
  // bajado antes de abrir la pestaña, workbox no siempre recarga: lo hacemos acá, y si en unos
  // segundos no pasó nada, se recarga igual (sin ticket abierto no se pierde nada).
  let recargando = false;
  const recargar = () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener('controllerchange', recargar, { once: true });
  const registro = await navigator.serviceWorker?.getRegistration();
  registro?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  await aplicar(true);
  setTimeout(recargar, 3000);
  return true;
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useHayVersionNueva = () => useSyncExternalStore(suscribir, () => hayNueva);
