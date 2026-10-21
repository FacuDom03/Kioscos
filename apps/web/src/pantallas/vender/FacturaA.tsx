// "Factura a": a nombre de quién sale la factura de esta venta, como en el punto de venta de
// Odoo. Por defecto, consumidor final, sin tocar nada. Solo aparece con la facturación prendida.
import { TOPE_IDENTIFICAR_CONSUMIDOR, formatearPlata } from '@mostrador/shared';
import { useEffect, useId, useRef, useState } from 'react';
import {
  CONDICIONES_IVA,
  FormClienteFiscal,
  documentoVisible,
  type CondicionIva,
  type TipoDocumento,
} from '../../componentes/ClienteFiscal.tsx';
import { Aviso } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { fijarComprador, useComprador, type CompradorElegido } from '../../nucleo/ticket.ts';

/** Desde este total ARCA pide identificar a quien compra (RG 5866/2026). */
export const hayQueIdentificar = (total: number) => total >= TOPE_IDENTIFICAR_CONSUMIDOR;

export function FacturaA({ total }: { total: number }) {
  const comprador = useComprador();
  const [abierto, setAbierto] = useState(false);
  const falta = hayQueIdentificar(total) && !comprador;
  return (
    <div className={`factura-a${falta ? ' factura-a--falta' : ''}`}>
      <div className="factura-a__fila">
        <span className="factura-a__etiqueta">Factura a</span>
        <span className="factura-a__quien">
          {comprador ? (
            <>
              <strong>{comprador.nombre}</strong>
              <span className="texto-suave">
                {documentoVisible(comprador.documento.tipo, comprador.documento.numero)},{' '}
                {CONDICIONES_IVA[comprador.condicion].toLowerCase()}
              </span>
            </>
          ) : (
            <strong>Consumidor final</strong>
          )}
        </span>
        <span className="factura-a__acciones">
          {comprador && (
            <button
              type="button"
              className="enlace-boton"
              onClick={() => fijarComprador(null)}
              aria-label="Volver a consumidor final"
            >
              Quitar
            </button>
          )}
          <button type="button" className="m-boton" onClick={() => setAbierto(true)}>
            {comprador ? 'Cambiar' : 'A nombre de alguien'}
          </button>
        </span>
      </div>
      {falta && (
        <p className="factura-a__aviso">
          Desde {formatearPlata(TOPE_IDENTIFICAR_CONSUMIDOR)} ARCA pide el DNI o CUIT de quien
          compra. Elegilo para poder cobrar.
        </p>
      )}
      {abierto && <ElegirComprador alCerrar={() => setAbierto(false)} />}
    </div>
  );
}

interface ClienteConDocumento {
  id: string;
  nombre: string;
  doc_tipo: TipoDocumento;
  doc_nro: string;
  condicion_iva: CondicionIva | null;
}

function ElegirComprador({ alCerrar }: { alCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const enLinea = useEnLinea();
  const [modo, setModo] = useState<'buscar' | 'nuevo'>('buscar');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<ClienteConDocumento[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Busca mientras se escribe (por nombre, CUIT o DNI).
  useEffect(() => {
    if (!enLinea || modo !== 'buscar') return;
    const t = setTimeout(() => {
      api<{ clientes: ClienteConDocumento[] }>(
        'GET',
        `/api/v1/clientes?conDocumento=si${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`,
      )
        .then((r) => {
          setLista(r.clientes.slice(0, 8));
          setError(null);
        })
        .catch((e: unknown) => setError(mensajeDeError(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, enLinea, modo]);

  function elegir(c: CompradorElegido) {
    fijarComprador(c);
    alCerrar();
  }

  return (
    <dialog
      ref={ref}
      className="dialogo dialogo--sistema dialogo--comprador"
      aria-labelledby={`${id}-titulo`}
      onCancel={(e) => {
        e.preventDefault();
        alCerrar();
      }}
    >
      <h2 id={`${id}-titulo`} className="subtitulo">
        {modo === 'buscar' ? '¿A nombre de quién?' : 'Cliente nuevo'}
      </h2>
      {!enLinea ? (
        <>
          <p>Sin internet no se pueden buscar clientes: la factura sale a consumidor final.</p>
          <div className="acciones">
            <button type="button" className="m-boton m-boton--principal" onClick={alCerrar}>
              Entendido
            </button>
          </div>
        </>
      ) : modo === 'buscar' ? (
        <>
          <div className="campo">
            <label htmlFor={`${id}-buscar`}>Buscar por nombre, CUIT o DNI</label>
            <input
              id={`${id}-buscar`}
              className="campo__entrada"
              type="search"
              autoComplete="off"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {error && <Aviso>{error}</Aviso>}
          {lista && lista.length > 0 && (
            <ul className="comprador__lista">
              {lista.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="comprador__opcion"
                    onClick={() =>
                      elegir({
                        id: c.id,
                        nombre: c.nombre,
                        documento: { tipo: c.doc_tipo, numero: c.doc_nro },
                        condicion: c.condicion_iva ?? 'consumidor_final',
                      })
                    }
                  >
                    <strong>{c.nombre}</strong>
                    <span className="texto-suave">{documentoVisible(c.doc_tipo, c.doc_nro)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lista && lista.length === 0 && (
            <p className="texto-suave">
              {q.trim()
                ? 'No hay un cliente así. Cargalo nuevo.'
                : 'Todavía no cargaste clientes con CUIT o DNI.'}
            </p>
          )}
          <div className="acciones">
            <button
              type="button"
              className="m-boton m-boton--principal"
              onClick={() => setModo('nuevo')}
            >
              Cliente nuevo
            </button>
            <button type="button" className="m-boton" onClick={alCerrar}>
              Cerrar
            </button>
          </div>
        </>
      ) : (
        <FormClienteFiscal
          inicial={
            /^\d{7,11}$/.test(q.replace(/\D/g, ''))
              ? {
                  nombre: '',
                  doc_tipo: q.replace(/\D/g, '').length === 11 ? 'cuit' : 'dni',
                  doc_nro: q.replace(/\D/g, ''),
                  condicion_iva: null,
                  domicilio: null,
                }
              : null
          }
          textoGuardar="Guardar y facturarle"
          alGuardar={elegir}
          alCancelar={() => setModo('buscar')}
        />
      )}
    </dialog>
  );
}
