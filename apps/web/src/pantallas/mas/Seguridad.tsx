import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { ConfigurarSegundoFactor } from '../acceso/Configurar.tsx';
import { avisar, confirmar } from '../../componentes/Dialogos.tsx';

interface Datos {
  totp: boolean;
  passkeys: { id: string; nombre: string; created_at: string }[];
  codigosRestantes: number;
}

export function Seguridad({ alVolver }: { alVolver: () => void }) {
  const { datos, error, recargar } = useDatos<Datos>('/api/v1/cuenta/seguridad');
  const [agregando, setAgregando] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function cambiarPassword(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    try {
      await api('POST', '/api/v1/cuenta/password', Object.fromEntries(new FormData(form)));
      form.reset();
      setAviso({
        tipo: 'ok',
        texto: 'Listo, cambiaste la contraseña. Cerramos tus otras sesiones.',
      });
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Seguridad</h1>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <section className="tarjeta-form">
        <h2 className="subtitulo">Segundo paso para entrar</h2>
        <p className="texto-suave">
          App de códigos: {datos?.totp ? 'configurada' : 'sin configurar'}
        </p>
        <ul className="lista-filas">
          {datos?.passkeys.map((p) => (
            <li key={p.id} className="tarjeta">
              <span>Passkey: {p.nombre}</span>
              <button
                type="button"
                className="m-boton m-boton--peligro"
                onClick={async () => {
                  try {
                    await api('DELETE', `/api/v1/cuenta/passkeys/${p.id}`);
                    await recargar();
                  } catch (e) {
                    setAviso({ tipo: 'error', texto: mensajeDeError(e) });
                  }
                }}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
        {agregando ? (
          <ConfigurarSegundoFactor
            dentroDeLaApp
            alTerminar={async () => {
              setAgregando(false);
              await recargar();
            }}
          />
        ) : (
          <button type="button" className="m-boton" onClick={() => setAgregando(true)}>
            Agregar passkey o app de códigos
          </button>
        )}
      </section>

      <section className="tarjeta-form">
        <h2 className="subtitulo">Códigos de recuperación</h2>
        <p className="texto-suave">Te quedan {datos?.codigosRestantes ?? '…'} sin usar.</p>
        {codigos ? (
          <ul className="codigos">
            {codigos.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            className="m-boton"
            onClick={async () => {
              if (
                !(await confirmar({
                  titulo: '¿Generar códigos nuevos?',
                  texto: 'Los códigos anteriores dejan de servir.',
                  aceptar: 'Generar códigos',
                }))
              )
                return;
              try {
                const r = await api<{ codigosRecuperacion: string[] }>(
                  'POST',
                  '/api/v1/cuenta/codigos',
                  {},
                );
                setCodigos(r.codigosRecuperacion);
                await recargar();
              } catch (e) {
                await avisar('No se pudieron generar los códigos', mensajeDeError(e));
              }
            }}
          >
            Generar códigos nuevos
          </button>
        )}
      </section>

      <form className="formulario tarjeta-form" onSubmit={cambiarPassword}>
        <h2 className="subtitulo">Cambiar contraseña</h2>
        <Campo
          etiqueta="Contraseña actual"
          name="actual"
          type="password"
          autoComplete="current-password"
          required
        />
        <Campo
          etiqueta="Contraseña nueva"
          name="nueva"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <button className="m-boton">Cambiar contraseña</button>
      </form>
    </div>
  );
}
