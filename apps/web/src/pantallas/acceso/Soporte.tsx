import { useEffect, useState } from 'react';
import { Aviso } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesion } from '../../nucleo/sesion.tsx';
import { MarcoAcceso } from './Acceso.tsx';

/** Entrada de soporte desde el panel: /soporte#<token>. */
export function EntradaSoporte() {
  const { recargar } = useSesion();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = location.hash.slice(1);
    history.replaceState(null, '', '/');
    api('POST', '/api/v1/auth/soporte', { token })
      .then(() => recargar())
      .then(() => navegar('/', true))
      .catch((e: unknown) => setError(mensajeDeError(e)));
  }, [recargar]);
  return (
    <MarcoAcceso titulo="Soporte">{error ? <Aviso>{error}</Aviso> : <p>Entrando…</p>}</MarcoAcceso>
  );
}
