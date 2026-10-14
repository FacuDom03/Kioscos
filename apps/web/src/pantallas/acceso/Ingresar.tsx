import { useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useSesion, type SesionPendiente } from '../../nucleo/sesion.tsx';
import { MarcoAcceso } from './Acceso.tsx';

export function Ingresar({ alUsarPin }: { alUsarPin?: (() => void) | undefined }) {
  const { fijar } = useSesion();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const datos = Object.fromEntries(new FormData(ev.currentTarget)) as {
      email: string;
      password: string;
    };
    setEnviando(true);
    setError(null);
    try {
      fijar(await api<SesionPendiente>('POST', '/api/v1/auth/login', datos));
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MarcoAcceso titulo="Entrar">
      <form className="formulario" onSubmit={enviar}>
        <Campo
          etiqueta="Email"
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
        />
        <Campo
          etiqueta="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton m-boton--principal" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      {alUsarPin && (
        <button type="button" className="enlace-boton" onClick={alUsarPin}>
          Soy cajero: entrar con PIN
        </button>
      )}
    </MarcoAcceso>
  );
}
