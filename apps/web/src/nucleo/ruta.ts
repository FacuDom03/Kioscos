// Navegación mínima con la History API (sin dependencias).
import { useEffect, useState } from 'react';

const evento = 'mostrador:ruta';

export function navegar(ruta: string, reemplazar = false): void {
  if (reemplazar) history.replaceState(null, '', ruta);
  else history.pushState(null, '', ruta);
  window.dispatchEvent(new Event(evento));
}

export function useRuta(): string {
  const [ruta, setRuta] = useState(location.pathname);
  useEffect(() => {
    const actualizar = () => setRuta(location.pathname);
    window.addEventListener('popstate', actualizar);
    window.addEventListener(evento, actualizar);
    return () => {
      window.removeEventListener('popstate', actualizar);
      window.removeEventListener(evento, actualizar);
    };
  }, []);
  return ruta;
}
