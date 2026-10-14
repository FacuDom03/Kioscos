import { useCallback, useEffect, useState } from 'react';
import { api, mensajeDeError } from './api.ts';

/** Carga un GET de la API y permite recargarlo. */
export function useDatos<T>(url: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>('GET', url)
      .then((d) => {
        if (!vigente) return;
        setDatos(d);
        setError(null);
      })
      .catch((e: unknown) => vigente && setError(mensajeDeError(e)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [url]);

  const recargar = useCallback(async () => {
    if (!url) return;
    try {
      setDatos(await api<T>('GET', url));
      setError(null);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, [url]);

  return { datos, error, cargando, recargar, setDatos };
}
