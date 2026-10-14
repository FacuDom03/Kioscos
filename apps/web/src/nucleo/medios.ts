import { useSyncExternalStore } from 'react';

// Computadora: ≥ 1024 px con puntero fino. Teclado físico: puntero fino y hover (sección 4.1).
const consultaPC = '(min-width: 1024px) and (pointer: fine)';
const consultaTeclado = '(pointer: fine) and (hover: hover)';

function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(q).matches,
  );
}

export const useEsPC = () => useMedia(consultaPC);
export const useHayTeclado = () => useMedia(consultaTeclado);
