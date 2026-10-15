import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

export interface Proveedor {
  id: string;
  nombre: string;
  productos: number;
  ultimaLista: string | null;
}

/** Proveedores del comercio y acceso a actualizar precios con su lista (etapa I3). */
export function Proveedores() {
  const s = useSesionCompleta();
  const { datos, error, recargar } = useDatos<Proveedor[]>('/api/v1/proveedores');
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const actualiza = puede.administrar(s.rol) || s.rol === 'soporte';

  async function alta(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const nombre = String(new FormData(form).get('nombre') ?? '').trim();
    if (!nombre) return;
    setErrorAlta(null);
    try {
      await api('POST', '/api/v1/proveedores', { nombre });
      form.reset();
      await recargar();
    } catch (e) {
      setErrorAlta(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Proveedores</h1>
      <p className="texto-suave">
        Cuando un proveedor te manda la lista nueva, subila acá y los precios se recalculan solos.
      </p>
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && <p className="vacio">Todavía no cargaste proveedores.</p>}
      {datos && datos.length > 0 && (
        <ul className="lista-filas">
          {datos.map((p) => (
            <li key={p.id} className="fila fila--proveedor">
              <span className="fila__texto">
                <span className="fila__titulo">{p.nombre}</span>
                <span className="texto-suave">
                  {p.productos === 1 ? '1 producto' : `${p.productos} productos`}
                  {p.ultimaLista &&
                    ` · Última lista: ${new Date(p.ultimaLista).toLocaleDateString('es-AR')}`}
                </span>
              </span>
              {actualiza && (
                <button
                  type="button"
                  className="m-boton"
                  onClick={() => navegar(`/stock/proveedores/${p.id}/lista`)}
                >
                  Subir lista nueva
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="formulario tarjeta-form" onSubmit={alta}>
        <h2 className="subtitulo">Nuevo proveedor</h2>
        <Campo etiqueta="Nombre" name="nombre" maxLength={80} required autoComplete="off" />
        {errorAlta && <Aviso>{errorAlta}</Aviso>}
        <button className="m-boton">Agregar</button>
      </form>
    </div>
  );
}
