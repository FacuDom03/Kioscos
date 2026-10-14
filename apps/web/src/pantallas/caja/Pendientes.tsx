import { formatearPlata } from '@mostrador/shared';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Pendiente {
  id: string;
  total: number;
  estado: string;
  devolucion_pendiente: boolean;
  creada_en_dispositivo: string;
  nombre: string | null;
}

/** Cobros con QR que no se confirmaron y devoluciones que faltan hacer en Mercado Pago. */
export function Pendientes() {
  const s = useSesionCompleta();
  const { datos, recargar } = useDatos<Pendiente[]>('/api/v1/ventas/pendientes');
  if (!datos?.length) return null;

  const resolver = async (id: string, accion: 'efectivo' | 'transferencia' | 'anular') => {
    try {
      await api('POST', `/api/v1/ventas/${id}/resolver`, { accion });
      await recargar();
    } catch (e) {
      alert(mensajeDeError(e));
    }
  };
  const devuelta = async (id: string) => {
    try {
      await api('POST', `/api/v1/ventas/${id}/devuelta`, {});
      await recargar();
    } catch (e) {
      alert(mensajeDeError(e));
    }
  };

  return (
    <section className="tarjeta-form pendientes">
      <h2 className="subtitulo">Para resolver</h2>
      <ul className="lista-filas">
        {datos.map((v) => (
          <li key={v.id} className="tarjeta">
            <div>
              <strong className="m-plata">{formatearPlata(v.total)}</strong>{' '}
              <span>
                {v.estado === 'pendiente_cobro'
                  ? 'Pendiente de cobro (QR sin confirmar)'
                  : 'Anulada, devolución pendiente'}
              </span>
              <p className="texto-suave">
                {new Date(v.creada_en_dispositivo).toLocaleString('es-AR')} · {v.nombre}
              </p>
            </div>
            <div className="acciones">
              {v.estado === 'pendiente_cobro' ? (
                <>
                  <button
                    type="button"
                    className="m-boton"
                    onClick={() => void resolver(v.id, 'efectivo')}
                  >
                    Se cobró en efectivo
                  </button>
                  <button
                    type="button"
                    className="m-boton"
                    onClick={() => void resolver(v.id, 'transferencia')}
                  >
                    Se cobró por transferencia
                  </button>
                  <button
                    type="button"
                    className="m-boton m-boton--peligro"
                    onClick={() => void resolver(v.id, 'anular')}
                  >
                    No se cobró: anular
                  </button>
                </>
              ) : (
                s.rol === 'dueno' && (
                  <button type="button" className="m-boton" onClick={() => void devuelta(v.id)}>
                    Ya la devolví en Mercado Pago
                  </button>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
