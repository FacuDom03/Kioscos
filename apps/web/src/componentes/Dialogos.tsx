import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';

// Diálogos propios en lugar de alert, confirm y prompt del navegador: se ven igual en todos los
// equipos, siguen el tema, ocultan lo secreto (un PIN) y funcionan bien en la app instalada.
// Se piden desde cualquier lado con `await confirmar(...)`, `await pedirTexto(...)` o
// `await avisar(...)`; el componente <Dialogos /> los muestra de a uno.

interface Confirmar {
  tipo: 'confirmar';
  titulo: string;
  texto?: string;
  aceptar: string;
  /** Acción que borra o deshace algo: el botón principal se marca como peligroso. */
  peligro?: boolean;
  resolver: (ok: boolean) => void;
}

interface PedirTexto {
  tipo: 'texto';
  titulo: string;
  etiqueta: string;
  aceptar: string;
  /** No se muestra lo que se escribe (un PIN). */
  secreto?: boolean;
  numerico?: boolean;
  /** Si no cumple, se muestra `error` y no se acepta. */
  valido?: (v: string) => boolean;
  error?: string;
  resolver: (v: string | null) => void;
}

interface Avisar {
  tipo: 'aviso';
  titulo: string;
  texto?: string;
  resolver: () => void;
}

type Pedido = (Confirmar | PedirTexto | Avisar) & { id: number };

let cola: Pedido[] = [];
let ultimoId = 0;
const oyentes = new Set<() => void>();
const avisarCambio = () => {
  for (const o of oyentes) o();
};
function poner(p: Confirmar | PedirTexto | Avisar) {
  cola = [...cola, { ...p, id: ++ultimoId }];
  avisarCambio();
}
function sacar() {
  cola = cola.slice(1);
  avisarCambio();
}

type SinResolver<T> = Omit<T, 'tipo' | 'resolver'>;

export const confirmar = (o: SinResolver<Confirmar>) =>
  new Promise<boolean>((resolver) => poner({ ...o, tipo: 'confirmar', resolver }));

export const pedirTexto = (o: SinResolver<PedirTexto>) =>
  new Promise<string | null>((resolver) => poner({ ...o, tipo: 'texto', resolver }));

export const avisar = (titulo: string, texto?: string) =>
  new Promise<void>((resolver) =>
    poner({ tipo: 'aviso', titulo, ...(texto ? { texto } : {}), resolver }),
  );

export function Dialogos() {
  const actual = useSyncExternalStore(
    (cb) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },
    () => cola[0] ?? null,
  );
  // Cada pedido es un diálogo nuevo (key), así el texto escrito no pasa de uno a otro.
  return actual ? <Dialogo key={actual.id} pedido={actual} /> : null;
}

function Dialogo({ pedido }: { pedido: Pedido }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const cerrar = (resultado: 'si' | 'no') => {
    if (pedido.tipo === 'confirmar') pedido.resolver(resultado === 'si');
    else if (pedido.tipo === 'texto') pedido.resolver(resultado === 'si' ? valor.trim() : null);
    else pedido.resolver();
    sacar();
  };

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (pedido.tipo === 'texto') {
      const v = valor.trim();
      if (!v || (pedido.valido && !pedido.valido(v))) {
        setError(pedido.error ?? 'Completá el dato.');
        return;
      }
    }
    cerrar('si');
  };

  return (
    <dialog
      ref={ref}
      className="dialogo dialogo--sistema"
      aria-labelledby={`${id}-titulo`}
      aria-describedby={'texto' in pedido && pedido.texto ? `${id}-texto` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        cerrar('no');
      }}
    >
      <form className="formulario" onSubmit={enviar} noValidate>
        <h2 id={`${id}-titulo`} className="subtitulo">
          {pedido.titulo}
        </h2>
        {'texto' in pedido && pedido.texto && <p id={`${id}-texto`}>{pedido.texto}</p>}
        {pedido.tipo === 'texto' && (
          <div className="campo">
            <label htmlFor={`${id}-valor`}>{pedido.etiqueta}</label>
            <input
              id={`${id}-valor`}
              className="campo__entrada"
              type={pedido.secreto ? 'password' : 'text'}
              inputMode={pedido.numerico ? 'numeric' : undefined}
              autoComplete="off"
              autoFocus
              value={valor}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => {
                setValor(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p id={`${id}-error`} className="campo__error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <div className="acciones">
          {pedido.tipo === 'aviso' ? (
            <button className="m-boton m-boton--principal" autoFocus>
              Entendido
            </button>
          ) : (
            <>
              <button
                className={`m-boton m-boton--principal${pedido.tipo === 'confirmar' && pedido.peligro ? ' m-boton--peligro' : ''}`}
                autoFocus={pedido.tipo === 'confirmar'}
              >
                {pedido.aceptar}
              </button>
              <button type="button" className="m-boton" onClick={() => cerrar('no')}>
                Cancelar
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
