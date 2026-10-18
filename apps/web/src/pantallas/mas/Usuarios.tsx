import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { avisar, pedirTexto } from '../../componentes/Dialogos.tsx';

interface Datos {
  personas: {
    id: string;
    nombre: string;
    email: string | null;
    rol: string;
    activa: boolean;
    tienePin: boolean;
    esVos: boolean;
  }[];
  invitaciones: { id: string; email: string; rol: string; vence_en: string }[];
}

const ROLES: Record<string, string> = { dueno: 'Dueño', encargado: 'Encargado', cajero: 'Cajero' };

export function Usuarios({ alVolver }: { alVolver: () => void }) {
  const { datos, error, recargar } = useDatos<Datos>('/api/v1/usuarios');
  const [formulario, setFormulario] = useState<'cajero' | 'encargado' | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<string | null>(null);

  async function crearCajero(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget));
    try {
      await api('POST', '/api/v1/usuarios/cajeros', f);
      setFormulario(null);
      await recargar();
    } catch (e) {
      setErrorForm(mensajeDeError(e));
    }
  }

  async function invitar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget));
    try {
      const r = await api<{ enlace: string }>('POST', '/api/v1/usuarios/invitaciones', f);
      setEnlace(r.enlace);
      setFormulario(null);
      await recargar();
    } catch (e) {
      setErrorForm(mensajeDeError(e));
    }
  }

  async function cambiarPin(id: string, nombre: string) {
    const pin = await pedirTexto({
      titulo: `PIN nuevo para ${nombre}`,
      etiqueta: 'PIN (4 a 6 números)',
      aceptar: 'Cambiar PIN',
      secreto: true,
      numerico: true,
      valido: (v) => /^\d{4,6}$/.test(v),
      error: 'El PIN tiene que tener de 4 a 6 números.',
    });
    if (!pin) return;
    try {
      await api('PUT', `/api/v1/usuarios/${id}/pin`, { pin });
      await avisar('PIN cambiado', `${nombre} ya puede entrar con el PIN nuevo.`);
      await recargar();
    } catch (e) {
      await avisar('No se pudo cambiar el PIN', mensajeDeError(e));
    }
  }

  async function activar(id: string, activa: boolean) {
    try {
      await api('PATCH', `/api/v1/usuarios/${id}`, { activa });
      await recargar();
    } catch (e) {
      await avisar('No se pudo cambiar el acceso', mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Usuarios</h1>
      {error && <Aviso>{error}</Aviso>}
      {enlace && (
        <Aviso tipo="ok">
          Mandale este enlace por WhatsApp (vence en 72 horas):{' '}
          <span className="enlace-copiable">{enlace}</span>{' '}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Entrá a Mostrador con este enlace: ${enlace}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir WhatsApp
          </a>
        </Aviso>
      )}
      <ul className="lista-filas">
        {datos?.personas.map((p) => (
          <li key={p.id} className="tarjeta">
            <div>
              <strong>{p.nombre || p.email}</strong>{' '}
              {p.esVos && <span className="texto-suave">(vos)</span>}
              <p className="texto-suave">
                {ROLES[p.rol]} · {p.activa ? 'Activo' : 'Desactivado'}
                {p.rol === 'cajero' && !p.tienePin && ' · Sin PIN'}
              </p>
            </div>
            {p.rol === 'cajero' && (
              <div className="acciones">
                <button
                  type="button"
                  className="m-boton"
                  onClick={() => cambiarPin(p.id, p.nombre)}
                >
                  Cambiar PIN
                </button>
                <button type="button" className="m-boton" onClick={() => activar(p.id, !p.activa)}>
                  {p.activa ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            )}
            {p.rol === 'encargado' && (
              <button type="button" className="m-boton" onClick={() => activar(p.id, !p.activa)}>
                {p.activa ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </li>
        ))}
        {datos?.invitaciones.map((i) => (
          <li key={i.id} className="tarjeta">
            <div>
              <strong>{i.email}</strong>
              <p className="texto-suave">Invitación pendiente · {ROLES[i.rol]}</p>
            </div>
            <button
              type="button"
              className="m-boton"
              onClick={async () => {
                await api('DELETE', `/api/v1/usuarios/invitaciones/${i.id}`).catch(() => undefined);
                await recargar();
              }}
            >
              Cancelar
            </button>
          </li>
        ))}
      </ul>

      {formulario === 'cajero' && (
        <form className="formulario tarjeta-form" onSubmit={crearCajero}>
          <h2 className="subtitulo">Nuevo cajero</h2>
          <Campo etiqueta="Nombre" name="nombre" required maxLength={60} />
          <Campo
            etiqueta="PIN (4 a 6 números)"
            name="pin"
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            autoComplete="off"
          />
          {errorForm && <Aviso>{errorForm}</Aviso>}
          <button className="m-boton m-boton--principal">Crear cajero</button>
        </form>
      )}
      {formulario === 'encargado' && (
        <form className="formulario tarjeta-form" onSubmit={invitar}>
          <h2 className="subtitulo">Invitar encargado</h2>
          <Campo etiqueta="Email del encargado" name="email" type="email" required />
          {errorForm && <Aviso>{errorForm}</Aviso>}
          <button className="m-boton m-boton--principal">Generar invitación</button>
        </form>
      )}
      {!formulario && (
        <div className="acciones">
          <button
            type="button"
            className="m-boton"
            onClick={() => {
              setErrorForm(null);
              setFormulario('cajero');
            }}
          >
            Agregar cajero
          </button>
          <button
            type="button"
            className="m-boton"
            onClick={() => {
              setErrorForm(null);
              setFormulario('encargado');
            }}
          >
            Invitar encargado
          </button>
        </div>
      )}
      <p className="texto-suave">
        El cajero entra con su PIN solo en los equipos que autorices en Dispositivos.
      </p>
    </div>
  );
}
