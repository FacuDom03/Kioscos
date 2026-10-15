import { formatearPlata, uuidv7 } from '@mostrador/shared';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Aviso } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { extrasDeVenta, type VentaHecha } from '../../nucleo/cobrar.ts';
import {
  cuentaTicket,
  listaActual,
  presupuestoActual,
  regaloActual,
  ticketActual,
  vaciarTicket,
} from '../../nucleo/ticket.ts';
import { turnoActual } from '../../nucleo/turno.ts';
import { useEstadoMp } from '../../nucleo/mp.ts';

type Estado =
  | { tipo: 'creando' }
  | { tipo: 'esperando'; pagoId: string; imagen: string }
  | { tipo: 'pendiente' }
  | { tipo: 'error'; mensaje: string };

/** Cobro con QR de Mercado Pago. El estado lo confirma el servidor; acá solo se pregunta. */
export function CobroQr({
  total,
  alCobrado,
  alCancelar,
}: {
  total: number;
  alCobrado: (v: VentaHecha) => void;
  alCancelar: () => void;
}) {
  const mp = useEstadoMp();
  const [estado, setEstado] = useState<Estado>({ tipo: 'creando' });
  const venta = useRef<{
    ventaId: string;
    pagoId: string;
    items: ReturnType<typeof ticketActual>;
    creadaEn: string;
    extras: ReturnType<typeof extrasDeVenta>;
  } | null>(null);
  const creado = useRef(false);

  useEffect(() => {
    if (creado.current || !mp?.puedeCobrar) return;
    creado.current = true;
    const turno = turnoActual();
    const items = ticketActual();
    if (!turno || !items.length) return;
    const cuenta = cuentaTicket(items);
    const datos = {
      ventaId: uuidv7(),
      pagoId: uuidv7(),
      items,
      creadaEn: new Date().toISOString(),
      extras: extrasDeVenta(cuenta),
    };
    venta.current = datos;
    api<{ pagoId: string; qr: string }>('POST', '/api/v1/cobros/qr', {
      ventaId: datos.ventaId,
      pagoId: datos.pagoId,
      turnoId: turno.id,
      creadaEn: datos.creadaEn,
      total,
      ...(listaActual() !== 'mostrador' ? { lista: listaActual() } : {}),
      ...(presupuestoActual() ? { presupuestoId: presupuestoActual()?.id } : {}),
      ...(cuenta.descuentos.length
        ? { descuentos: cuenta.descuentos.map((d) => ({ promoId: d.promoId, monto: d.monto })) }
        : {}),
      ...(regaloActual() ? { regalo: true } : {}),
      items: items.map((i) => ({
        id: i.id,
        productoId: i.productoId,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
      })),
    })
      .then(async (r) =>
        setEstado({
          tipo: 'esperando',
          pagoId: r.pagoId,
          imagen: await QRCode.toDataURL(r.qr, {
            margin: 2,
            width: 320,
            errorCorrectionLevel: 'M',
          }),
        }),
      )
      .catch((e: unknown) => setEstado({ tipo: 'error', mensaje: mensajeDeError(e) }));
  }, [mp?.puedeCobrar, total]);

  // Pregunta cada 2 segundos mientras la pantalla está abierta.
  useEffect(() => {
    if (estado.tipo !== 'esperando') return;
    let vigente = true;
    const t = setInterval(async () => {
      try {
        const r = await api<{ estado: string; confirmadoEn: string | null; ventaEstado: string }>(
          'GET',
          `/api/v1/pagos/${estado.pagoId}`,
        );
        if (!vigente) return;
        if (r.estado === 'aprobado' && venta.current) {
          clearInterval(t);
          vaciarTicket();
          alCobrado({
            id: venta.current.ventaId,
            creadaEn: venta.current.creadaEn,
            items: venta.current.items,
            total,
            medio: 'qr_mp',
            confirmadoEn: r.confirmadoEn ?? new Date().toISOString(),
            ...venta.current.extras,
          });
        } else if (r.ventaEstado === 'pendiente_cobro') {
          clearInterval(t);
          vaciarTicket();
          setEstado({ tipo: 'pendiente' });
        } else if (r.estado === 'cancelado') {
          clearInterval(t);
          alCancelar();
        }
      } catch {
        // Un corte momentáneo: se vuelve a preguntar en 2 segundos.
      }
    }, 2000);
    return () => {
      vigente = false;
      clearInterval(t);
    };
  }, [estado, total, alCobrado, alCancelar]);

  async function cancelar() {
    if (estado.tipo === 'esperando') {
      const r = await api<{ estado: string }>(
        'POST',
        `/api/v1/pagos/${estado.pagoId}/cancelar`,
        {},
      ).catch(() => ({ estado: 'error' }));
      if (r.estado === 'aprobado') return; // ya pagó: lo confirma la próxima consulta
    }
    alCancelar();
  }

  if (!mp?.puedeCobrar) {
    return (
      <div className="formulario">
        <Aviso tipo="info">
          Para cobrar con QR, el dueño tiene que conectar Mercado Pago en Más → Conexiones.
        </Aviso>
        <button type="button" className="m-boton" onClick={alCancelar}>
          Elegir otro medio
        </button>
      </div>
    );
  }

  return (
    <div className="formulario cobro-qr">
      {estado.tipo === 'creando' && <p aria-live="polite">Generando el QR…</p>}
      {estado.tipo === 'error' && (
        <>
          <Aviso>{estado.mensaje}</Aviso>
          <button type="button" className="m-boton" onClick={alCancelar}>
            Elegir otro medio
          </button>
        </>
      )}
      {estado.tipo === 'esperando' && (
        <>
          <div className="qr-papel">
            <img
              src={estado.imagen}
              alt={`Código QR para pagar ${formatearPlata(total)} con Mercado Pago`}
              className="qr-papel__imagen"
            />
          </div>
          <p className="esperando" aria-live="polite">
            Esperando el pago
            <span className="puntitos" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
          <button
            type="button"
            className="m-boton m-boton--peligro"
            onClick={() => void cancelar()}
          >
            Cancelar cobro
          </button>
        </>
      )}
      {estado.tipo === 'pendiente' && (
        <>
          <Aviso tipo="info">
            Mercado Pago no confirmó el pago a tiempo. La venta quedó pendiente de cobro: el dueño o
            el encargado la resuelve en Caja.
          </Aviso>
          <button type="button" className="m-boton m-boton--principal" onClick={alCancelar}>
            Nueva venta
          </button>
        </>
      )}
    </div>
  );
}
