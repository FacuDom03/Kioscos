import { formatearPlata, nombreModulo, uuidv7 } from '@mostrador/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { enPalabras, type ClienteResumen } from '../../nucleo/clientes.ts';
import { cobrarACuenta, type VentaHecha } from '../../nucleo/cobrar.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { useNegocio } from '../../nucleo/rubro.ts';

/** Cobrar anotando en la cuenta corriente (fiado) de un cliente (etapa I5). */
export function ACuenta({
  total,
  alCobrado,
}: {
  total: number;
  alCobrado: (v: VentaHecha) => void;
}) {
  const enLinea = useEnLinea();
  const { rubro } = useNegocio();
  const [q, setQ] = useState('');
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [elegido, setElegido] = useState<ClienteResumen | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!enLinea) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<{ clientes: ClienteResumen[] }>(
        'GET',
        `/api/v1/clientes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '?deben=si'}`,
      )
        .then((r) => vigente && setClientes(r.clientes.slice(0, 8)))
        .catch(() => undefined);
    }, 200);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q, enLinea]);

  async function alta(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const nombre = String(f.get('nombre') ?? '').trim();
    const telefono = String(f.get('telefono') ?? '').trim();
    try {
      const { id, limite } = await api<{ id: string; limite: number | null }>(
        'POST',
        '/api/v1/clientes',
        {
          id: uuidv7(),
          nombre,
          ...(telefono ? { telefono } : {}),
        },
      );
      setElegido({
        id,
        nombre,
        telefono: telefono || null,
        nota: null,
        limite,
        saldo: 0,
        ultimo: null,
        doc_tipo: null,
        doc_nro: null,
        condicion_iva: null,
        domicilio: null,
      });
      setNuevo(false);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function anotar() {
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    try {
      alCobrado(await cobrarACuenta(elegido));
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  if (!enLinea)
    return (
      <Aviso tipo="info">
        Para anotar en la cuenta hace falta internet: así se revisa el límite en el momento.
      </Aviso>
    );

  const queda = elegido ? elegido.saldo + total : 0;
  const pasa = elegido?.limite != null && queda > elegido.limite;

  return (
    <div className="formulario a-cuenta">
      {elegido ? (
        <section className="tarjeta-cliente" aria-label="Cliente elegido">
          <div className="tarjeta-cliente__cabeza">
            <strong>{elegido.nombre}</strong>
            <button type="button" className="enlace-boton" onClick={() => setElegido(null)}>
              Cambiar
            </button>
          </div>
          <dl className="tarjeta-cliente__datos">
            <div>
              <dt>Ahora</dt>
              <dd>{enPalabras(elegido.saldo)}</dd>
            </div>
            <div>
              <dt>Con esta compra</dt>
              <dd>
                <strong>{enPalabras(queda)}</strong>
              </dd>
            </div>
            {elegido.limite != null && (
              <div>
                <dt>Límite</dt>
                <dd>{formatearPlata(elegido.limite)}</dd>
              </div>
            )}
          </dl>
          {pasa &&
            (elegido.limite === 0 ? (
              <Aviso>
                Todavía no tiene fiado: el dueño o el encargado le tiene que poner un límite en{' '}
                {nombreModulo(rubro, 'cuenta_corriente')}.
              </Aviso>
            ) : (
              <Aviso>
                Con esta compra pasa su límite. Cobrale una parte o pedile al dueño que le suba el
                límite.
              </Aviso>
            ))}
        </section>
      ) : nuevo ? (
        <form className="formulario tarjeta-form" onSubmit={alta}>
          <Campo
            etiqueta="Nombre"
            name="nombre"
            maxLength={80}
            required
            autoFocus
            autoComplete="off"
          />
          <Campo
            etiqueta="Teléfono (opcional)"
            name="telefono"
            type="tel"
            inputMode="tel"
            maxLength={30}
            pattern="[0-9 +()\-]{6,30}"
            autoComplete="off"
            ayuda="Para mandarle el detalle por WhatsApp."
          />
          <div className="acciones">
            <button className="m-boton m-boton--accion">Agregar cliente</button>
            <button type="button" className="m-boton" onClick={() => setNuevo(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <Campo
            etiqueta={`¿A quién se lo anotás?`}
            type="search"
            value={q}
            autoFocus
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscá por nombre"
          />
          <ul className="lista-clientes" aria-label="Clientes">
            {clientes.map((c) => (
              <li key={c.id}>
                <button type="button" className="fila fila--cliente" onClick={() => setElegido(c)}>
                  <span>{c.nombre}</span>
                  <span className="texto-suave">{enPalabras(c.saldo)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="m-boton" onClick={() => setNuevo(true)}>
            Cliente nuevo
          </button>
        </>
      )}
      {error && <Aviso>{error}</Aviso>}
      {elegido && (
        <button
          type="button"
          className="m-boton m-boton--principal"
          disabled={enviando || pasa}
          onClick={() => void anotar()}
        >
          Anotar {formatearPlata(total)}{' '}
          {nombreModulo(rubro, 'cuenta_corriente') === 'Fiado' ? 'en el fiado' : 'en la cuenta'}
        </button>
      )}
    </div>
  );
}
