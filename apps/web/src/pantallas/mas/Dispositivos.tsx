import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Dispositivo {
  id: string;
  nombre: string;
  ultimo_uso: string | null;
  esEste: boolean;
}

export function Dispositivos({ alVolver }: { alVolver: () => void }) {
  const { datos, error, recargar } = useDatos<Dispositivo[]>('/api/v1/dispositivos');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const esteAutorizado = datos?.some((d) => d.esEste);

  async function autorizar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    try {
      await api('POST', '/api/v1/dispositivos', Object.fromEntries(new FormData(ev.currentTarget)));
      await recargar();
    } catch (e) {
      setErrorForm(mensajeDeError(e));
    }
  }

  async function quitar(d: Dispositivo) {
    if (
      !confirm(`¿Quitar "${d.nombre}"? Los cajeros ya no van a poder entrar con PIN en ese equipo.`)
    )
      return;
    try {
      await api('DELETE', `/api/v1/dispositivos/${d.id}`);
      await recargar();
    } catch (e) {
      alert(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Dispositivos</h1>
      <p className="texto-suave">
        Los cajeros solo pueden entrar con PIN en los equipos autorizados.
      </p>
      {error && <Aviso>{error}</Aviso>}
      <ul className="lista-filas">
        {datos?.map((d) => (
          <li key={d.id} className="tarjeta">
            <div>
              <strong>{d.nombre}</strong>{' '}
              {d.esEste && <span className="texto-suave">(este equipo)</span>}
              <p className="texto-suave">
                {d.ultimo_uso
                  ? `Último uso: ${new Date(d.ultimo_uso).toLocaleString('es-AR')}`
                  : 'Sin usar todavía'}
              </p>
            </div>
            <button type="button" className="m-boton m-boton--peligro" onClick={() => quitar(d)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {!esteAutorizado && (
        <form className="formulario tarjeta-form" onSubmit={autorizar}>
          <h2 className="subtitulo">Autorizar este equipo</h2>
          <Campo
            etiqueta="Nombre del equipo"
            name="nombre"
            defaultValue="PC mostrador"
            required
            maxLength={60}
          />
          {errorForm && <Aviso>{errorForm}</Aviso>}
          <button className="m-boton m-boton--principal">Autorizar este equipo</button>
        </form>
      )}
    </div>
  );
}
