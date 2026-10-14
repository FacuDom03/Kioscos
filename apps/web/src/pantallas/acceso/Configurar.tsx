import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { MarcoAcceso } from './Acceso.tsx';

interface Resultado {
  codigosRecuperacion: string[] | null;
}

/**
 * Configura el segundo factor obligatorio: passkey (huella, PIN del celular o Windows Hello) o
 * una app de códigos (TOTP). Se usa al entrar por primera vez y desde Seguridad.
 */
export function ConfigurarSegundoFactor({
  alTerminar,
  dentroDeLaApp = false,
}: {
  alTerminar: (r: Resultado & Record<string, unknown>) => void;
  dentroDeLaApp?: boolean;
}) {
  const [qr, setQr] = useState<{ imagen: string; secreto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const soportaPasskey = browserSupportsWebAuthn();

  async function conPasskey() {
    setError(null);
    try {
      const opciones = await api<PublicKeyCredentialCreationOptionsJSON>(
        'POST',
        '/api/v1/auth/configurar/passkey/opciones',
        {},
      );
      const respuesta = await startRegistration({ optionsJSON: opciones });
      alTerminar(
        await api('POST', '/api/v1/auth/configurar/passkey/verificar', {
          respuesta,
          nombre: nombreDelEquipo(),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Se canceló. Probá de nuevo.'
          : mensajeDeError(e),
      );
    }
  }

  async function conApp() {
    setError(null);
    try {
      const r = await api<{ secreto: string; otpauth: string }>(
        'POST',
        '/api/v1/auth/configurar/totp',
        {},
      );
      setQr({
        imagen: await QRCode.toDataURL(r.otpauth, { margin: 1, width: 220 }),
        secreto: r.secreto,
      });
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function confirmar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const codigo = String(new FormData(ev.currentTarget).get('codigo') ?? '');
    try {
      alTerminar(await api('POST', '/api/v1/auth/configurar/totp/confirmar', { codigo }));
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  const contenido = qr ? (
    <form className="formulario" onSubmit={confirmar}>
      <p>
        Escaneá este código con tu app de códigos (Google Authenticator, Microsoft Authenticator u
        otra).
      </p>
      <img
        className="qr-totp"
        src={qr.imagen}
        alt="Código QR para la app de códigos"
        width={220}
        height={220}
      />
      <p className="texto-suave">
        Si no podés escanear, escribí este código en la app:{' '}
        <code className="secreto">{qr.secreto}</code>
      </p>
      <Campo
        etiqueta="Código de 6 números que muestra la app"
        name="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      {error && <Aviso>{error}</Aviso>}
      <button className="m-boton m-boton--principal">Confirmar</button>
    </form>
  ) : (
    <div className="formulario">
      <p>
        Para cuidar la plata y los datos del kiosco, además de la contraseña hace falta un segundo
        paso. Elegí uno.
      </p>
      {soportaPasskey && (
        <button type="button" className="m-boton m-boton--principal" onClick={conPasskey}>
          Usar la huella o el PIN de este equipo
        </button>
      )}
      <button type="button" className="m-boton" onClick={conApp}>
        Usar una app de códigos
      </button>
      {error && <Aviso>{error}</Aviso>}
    </div>
  );

  return dentroDeLaApp ? contenido : <MarcoAcceso titulo="Un paso más">{contenido}</MarcoAcceso>;
}

function nombreDelEquipo(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Celular Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone o iPad';
  if (/Windows/i.test(ua)) return 'PC con Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Este equipo';
}

export function CodigosRecuperacion({
  codigos,
  alTerminar,
}: {
  codigos: string[];
  alTerminar: () => void;
}) {
  const descargar = () => {
    const texto = `Códigos de recuperación de Mostrador\nCada uno sirve una sola vez.\n\n${codigos.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mostrador-codigos-de-recuperacion.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <MarcoAcceso titulo="Guardá estos códigos">
      <p>
        Si perdés el celular, con uno de estos códigos podés entrar. Cada uno sirve una sola vez.
        Anotalos o descargalos.
      </p>
      <ul className="codigos">
        {codigos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <button type="button" className="m-boton" onClick={descargar}>
        Descargar
      </button>
      <button type="button" className="m-boton m-boton--principal" onClick={alTerminar}>
        Ya los guardé
      </button>
    </MarcoAcceso>
  );
}
