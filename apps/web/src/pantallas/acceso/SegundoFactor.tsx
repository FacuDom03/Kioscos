import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useSesion, type SesionCompleta, type SesionPendiente } from '../../nucleo/sesion.tsx';
import { MarcoAcceso } from './Acceso.tsx';

export function SegundoFactor({ sesion }: { sesion: SesionPendiente }) {
  const { fijar, salir } = useSesion();
  const [modo, setModo] = useState<'totp' | 'recuperacion'>('totp');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function conPasskey() {
    setError(null);
    try {
      const opciones = await api<PublicKeyCredentialRequestOptionsJSON>(
        'POST',
        '/api/v1/auth/passkey/opciones',
        {},
      );
      const respuesta = await startAuthentication({ optionsJSON: opciones });
      fijar(await api<SesionCompleta>('POST', '/api/v1/auth/passkey/verificar', { respuesta }));
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Se canceló. Probá de nuevo.'
          : mensajeDeError(e),
      );
    }
  }

  async function conCodigo(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const codigo = String(new FormData(ev.currentTarget).get('codigo') ?? '');
    setEnviando(true);
    setError(null);
    try {
      const url = modo === 'totp' ? '/api/v1/auth/totp' : '/api/v1/auth/recuperacion';
      fijar(await api<SesionCompleta>('POST', url, { codigo }));
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MarcoAcceso titulo="Confirmá que sos vos">
      {sesion.metodos?.passkey && (
        <>
          <button type="button" className="m-boton m-boton--principal" onClick={conPasskey}>
            Usar huella o PIN del equipo
          </button>
          <p className="separador-texto">o</p>
        </>
      )}
      <form className="formulario" onSubmit={conCodigo}>
        {modo === 'totp' ? (
          <Campo
            etiqueta="Código de 6 números de tu app de códigos"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
          />
        ) : (
          <Campo etiqueta="Código de recuperación" name="codigo" autoComplete="off" required />
        )}
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton" disabled={enviando}>
          Confirmar
        </button>
      </form>
      <button
        type="button"
        className="enlace-boton"
        onClick={() => setModo(modo === 'totp' ? 'recuperacion' : 'totp')}
      >
        {modo === 'totp'
          ? 'Perdí el celular: usar un código de recuperación'
          : 'Usar el código de la app'}
      </button>
      <button type="button" className="enlace-boton" onClick={salir}>
        Cancelar
      </button>
    </MarcoAcceso>
  );
}
