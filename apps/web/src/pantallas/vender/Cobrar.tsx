import { formatearPlata, montosRapidos, vuelto } from '@mostrador/shared';
import { CartelTotal } from '@mostrador/ui';
import { useEffect, useState } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { cobrar, type VentaHecha } from '../../nucleo/cobrar.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { CobroQr } from './CobroQr.tsx';
import { useEstadoMp } from '../../nucleo/mp.ts';

export type Medio = 'efectivo' | 'qr' | 'transferencia';

interface Props {
  total: number;
  medioInicial: Medio | null;
  enPanel: boolean;
  alVolver: () => void;
  alCobrado: (v: VentaHecha) => void;
}

export function Cobrar({ total, medioInicial, enPanel, alVolver, alCobrado }: Props) {
  const enLinea = useEnLinea();
  const mp = useEstadoMp();
  const qrDisponible = enLinea && !!mp?.puedeCobrar;
  const [medio, setMedio] = useState<Medio | null>(medioInicial ?? (enLinea ? null : 'efectivo'));
  const [recibido, setRecibido] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const elVuelto = recibido !== null ? vuelto(total, recibido) : null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && medio !== 'qr') {
        e.preventDefault();
        alVolver();
      }
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [alVolver, medio]);

  async function confirmar(m: 'efectivo' | 'transferencia') {
    if (m === 'efectivo' && recibido !== null && recibido < total) {
      setError(`Falta plata: el cliente tiene que pagar al menos ${formatearPlata(total)}.`);
      return;
    }
    setEnviando(true);
    try {
      alCobrado(await cobrar(m, m === 'efectivo' ? (recibido ?? total) : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar.');
      setEnviando(false);
    }
  }

  return (
    <div className={enPanel ? 'cobrar cobrar--panel' : 'cobrar pantalla'}>
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Cobrar</h1>
      <div className="cobrar__total">
        <CartelTotal
          centavos={total}
          variante={enPanel ? 'venta' : 'cobro'}
          etiqueta="Total a cobrar"
        />
      </div>
      <fieldset className="campo">
        <legend>¿Cómo paga?</legend>
        <div className="medios">
          {(['efectivo', 'qr', 'transferencia'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="medio"
              aria-pressed={medio === m}
              disabled={m === 'qr' && !qrDisponible}
              onClick={() => {
                setMedio(m);
                setError(null);
              }}
            >
              {m === 'efectivo'
                ? 'Efectivo'
                : m === 'qr'
                  ? !enLinea
                    ? 'QR (necesita internet)'
                    : qrDisponible
                      ? 'QR'
                      : 'QR (sin conectar)'
                  : 'Transferencia'}
            </button>
          ))}
        </div>
      </fieldset>
      {!enLinea && (
        <p className="texto-suave">
          Sin internet no se puede generar el QR. Por ahora, cobrá en efectivo.
        </p>
      )}

      {medio === 'efectivo' && (
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar('efectivo');
          }}
        >
          <CampoPlata
            etiqueta="¿Con cuánto paga?"
            valor={recibido}
            alCambiar={setRecibido}
            autoFocus
          />
          <div className="montos-rapidos">
            {montosRapidos(total).map((m) => (
              <button key={m} type="button" className="m-boton" onClick={() => setRecibido(m)}>
                {formatearPlata(m)}
              </button>
            ))}
            <button type="button" className="m-boton" onClick={() => setRecibido(total)}>
              Justo
            </button>
          </div>
          <div className="vuelto" aria-live="polite">
            {elVuelto !== null ? (
              <>
                <span className="vuelto__etiqueta">Vuelto</span>
                <span className="vuelto__monto m-plata">{formatearPlata(elVuelto)}</span>
              </>
            ) : recibido !== null ? (
              <span className="vuelto__falta">Falta plata</span>
            ) : null}
          </div>
          {error && <Aviso>{error}</Aviso>}
          <button className="m-boton m-boton--principal" disabled={enviando}>
            Cobrar en efectivo
          </button>
        </form>
      )}

      {medio === 'transferencia' && (
        <div className="formulario">
          <p>Cuando veas la transferencia en tu cuenta, confirmala.</p>
          {error && <Aviso>{error}</Aviso>}
          <button
            type="button"
            className="m-boton m-boton--principal"
            disabled={enviando}
            onClick={() => void confirmar('transferencia')}
          >
            Transferencia recibida
          </button>
        </div>
      )}

      {medio === 'qr' && (
        <CobroQr total={total} alCobrado={alCobrado} alCancelar={() => setMedio(null)} />
      )}
    </div>
  );
}
