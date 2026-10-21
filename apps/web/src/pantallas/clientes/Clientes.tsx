import { formatearPlata, nombreModulo, uuidv7 } from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { enPalabras, type ClienteResumen } from '../../nucleo/clientes.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { FormClienteFiscal, documentoVisible } from '../../componentes/ClienteFiscal.tsx';

/**
 * Clientes: con la cuenta corriente / fiado (etapa I5) y, con la facturación, los datos para
 * facturarles a su nombre. Lo de la cuenta solo aparece si está prendida.
 */
export function Clientes({ alVolver }: { alVolver: () => void }) {
  const negocio = useNegocio();
  const fiado = negocio.tiene('cuenta_corriente');
  const factura = negocio.tiene('facturacion');
  const titulo = fiado ? nombreModulo(negocio.rubro, 'cuenta_corriente') : 'Clientes';
  const [q, setQ] = useState('');
  const [soloDeben, setSoloDeben] = useState(fiado);
  const params = new URLSearchParams({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(soloDeben ? { deben: 'si' } : {}),
  }).toString();
  const { datos, error, recargar } = useDatos<{ totalDeuda: number; clientes: ClienteResumen[] }>(
    `/api/v1/clientes${params ? `?${params}` : ''}`,
  );
  const [nuevo, setNuevo] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  async function alta(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const telefono = String(f.get('telefono') ?? '').trim();
    try {
      const { id } = await api<{ id: string }>('POST', '/api/v1/clientes', {
        id: uuidv7(),
        nombre: String(f.get('nombre') ?? '').trim(),
        ...(telefono ? { telefono } : {}),
      });
      navegar(`/clientes/${id}`);
    } catch (e) {
      setErrorAlta(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={alVolver} />
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">{titulo}</h1>
        <button type="button" className="m-boton m-boton--accion" onClick={() => setNuevo(true)}>
          Cliente nuevo
        </button>
      </div>
      {datos && fiado && (
        <p className="total-deuda">
          Te deben <strong className="m-plata">{formatearPlata(datos.totalDeuda)}</strong> en total.
        </p>
      )}
      {nuevo && !fiado && factura && (
        <section className="tarjeta-form">
          <h2 className="subtitulo">Cliente nuevo</h2>
          <FormClienteFiscal
            textoGuardar="Agregar"
            alGuardar={(c) => navegar(`/clientes/${c.id}`)}
            alCancelar={() => setNuevo(false)}
          />
        </section>
      )}
      {nuevo && fiado && (
        <form className="formulario tarjeta-form" onSubmit={alta}>
          <h2 className="subtitulo">Cliente nuevo</h2>
          <div className="dos-columnas">
            <Campo etiqueta="Nombre" name="nombre" maxLength={80} required autoFocus />
            <Campo
              etiqueta="Teléfono (opcional)"
              name="telefono"
              type="tel"
              inputMode="tel"
              maxLength={30}
              pattern="[0-9 +()\-]{6,30}"
            />
          </div>
          {errorAlta && <Aviso>{errorAlta}</Aviso>}
          <div className="acciones">
            <button className="m-boton m-boton--accion">Agregar</button>
            <button type="button" className="m-boton" onClick={() => setNuevo(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      <label className="m-solo-lectores" htmlFor="buscar-cliente">
        Buscar cliente
      </label>
      <input
        id="buscar-cliente"
        className="buscador__campo"
        type="search"
        placeholder="Buscar cliente"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {fiado && (
        <div className="chips" role="group" aria-label="Filtro">
          <button
            type="button"
            className="chip"
            aria-pressed={soloDeben}
            onClick={() => setSoloDeben(true)}
          >
            Los que deben
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={!soloDeben}
            onClick={() => setSoloDeben(false)}
          >
            Todos
          </button>
        </div>
      )}
      {error && (
        <Aviso>
          {error}{' '}
          <button type="button" className="enlace-boton" onClick={() => void recargar()}>
            Reintentar
          </button>
        </Aviso>
      )}
      {datos && datos.clientes.length === 0 && (
        <p className="vacio">{soloDeben ? 'Nadie debe nada.' : 'Todavía no hay clientes.'}</p>
      )}
      {datos && datos.clientes.length > 0 && (
        <ul className="lista-filas">
          {datos.clientes.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="fila fila--cliente"
                onClick={() => navegar(`/clientes/${c.id}`)}
              >
                <span className="fila__texto">
                  <span className="fila__titulo">{c.nombre}</span>
                  {factura && c.doc_tipo && c.doc_nro && (
                    <span className="texto-suave">{documentoVisible(c.doc_tipo, c.doc_nro)}</span>
                  )}
                  {fiado && c.ultimo && (
                    <span className="texto-suave">
                      Último movimiento: {new Date(c.ultimo).toLocaleDateString('es-AR')}
                    </span>
                  )}
                </span>
                {fiado && (
                  <span className={c.saldo > 0 ? 'saldo saldo--debe' : 'saldo'}>
                    {enPalabras(c.saldo)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
