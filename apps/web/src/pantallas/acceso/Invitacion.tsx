import { useEffect, useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesion, type SesionPendiente } from '../../nucleo/sesion.tsx';
import { MarcoAcceso } from './Acceso.tsx';

interface DatosInvitacion {
  kiosco: string;
  email: string;
  rol: 'dueno' | 'encargado';
  usuarioExiste: boolean;
}

/** Enlace de invitación: /invitacion#<token>. El token va en el fragmento, que no viaja al servidor ni a los logs. */
export function Invitacion() {
  const { fijar } = useSesion();
  const token = location.hash.slice(1);
  const [datos, setDatos] = useState<DatosInvitacion | null>(null);
  const [error, setError] = useState<string | null>(
    token ? null : 'El enlace está incompleto. Abrilo de nuevo desde el mensaje que te mandaron.',
  );
  const [errorForm, setErrorForm] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<DatosInvitacion>('GET', `/api/v1/auth/invitaciones/${encodeURIComponent(token)}`)
      .then(setDatos)
      .catch((e: unknown) => setError(mensajeDeError(e)));
  }, [token]);

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as Record<string, string>;
    if (!datos?.usuarioExiste && f['password'] !== f['repetir']) {
      setErrorForm('Las contraseñas no coinciden.');
      return;
    }
    try {
      const r = await api<SesionPendiente>(
        'POST',
        `/api/v1/auth/invitaciones/${encodeURIComponent(token)}`,
        {
          nombre: f['nombre'],
          password: f['password'],
        },
      );
      history.replaceState(null, '', '/');
      fijar(r);
      navegar('/', true);
    } catch (e) {
      setErrorForm(mensajeDeError(e));
    }
  }

  if (error) {
    return (
      <MarcoAcceso titulo="Invitación">
        <Aviso>{error}</Aviso>
      </MarcoAcceso>
    );
  }
  if (!datos) return <MarcoAcceso titulo="Invitación">{null}</MarcoAcceso>;

  return (
    <MarcoAcceso titulo={`Bienvenido a ${datos.kiosco}`}>
      <p>
        Te invitaron como <strong>{datos.rol === 'dueno' ? 'dueño' : 'encargado'}</strong> con el
        email {datos.email}.
      </p>
      <form className="formulario" onSubmit={enviar}>
        <Campo
          etiqueta="Tu nombre"
          name="nombre"
          autoComplete="given-name"
          required
          maxLength={60}
        />
        {datos.usuarioExiste ? (
          <Campo
            etiqueta="Tu contraseña de siempre"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        ) : (
          <>
            <Campo
              etiqueta="Elegí una contraseña"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              ayuda="Al menos 10 caracteres. Una frase es más fácil de recordar."
            />
            <Campo
              etiqueta="Repetí la contraseña"
              name="repetir"
              type="password"
              autoComplete="new-password"
              required
            />
          </>
        )}
        {errorForm && <Aviso>{errorForm}</Aviso>}
        <button className="m-boton m-boton--principal">Seguir</button>
      </form>
    </MarcoAcceso>
  );
}
