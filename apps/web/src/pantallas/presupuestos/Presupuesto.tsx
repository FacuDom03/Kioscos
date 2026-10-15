import { formatearCantidad, formatearPlata } from '@mostrador/shared';
import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import {
  ESTADOS,
  enlaceWhatsApp,
  fechaCorta,
  textoWhatsApp,
  venderPresupuesto,
  type Presupuesto,
} from '../../nucleo/presupuestos.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { ticketActual } from '../../nucleo/ticket.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { PresupuestoImpreso, imprimirPresupuesto } from './PresupuestoImpreso.tsx';

/** Un presupuesto: mandarlo, imprimirlo, cobrarlo o anularlo (etapa I4). */
export function PresupuestoPantalla({ id }: { id: string }) {
  const s = useSesionCompleta();
  const { datos: p, error, recargar } = useDatos<Presupuesto>(`/api/v1/presupuestos/${id}`);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const volver = () => navegar('/presupuestos');

  if (error) {
    return (
      <div className="pantalla">
        <Volver onClick={volver} />
        <Aviso>{error}</Aviso>
      </div>
    );
  }
  if (!p) return <div className="pantalla" aria-busy="true" />;
  const sePuedeVender = p.estado === 'abierto' || p.estado === 'vencido';

  function vender(preciosDeHoy: boolean) {
    if (!p) return;
    if (
      ticketActual().length &&
      !confirm('Hay productos en el ticket. ¿Los reemplazamos por los del presupuesto?')
    )
      return;
    venderPresupuesto(p, preciosDeHoy);
    navegar('/');
  }

  async function anular() {
    if (!confirm(`¿Anular el presupuesto ${p?.numero}?`)) return;
    try {
      await api('POST', `/api/v1/presupuestos/${id}/anular`, {});
      await recargar();
    } catch (e) {
      setErrorAccion(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={volver} />
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">Presupuesto {p.numero}</h1>
        <span className={`estado-presupuesto estado-presupuesto--${p.estado}`}>
          {ESTADOS[p.estado]}
        </span>
      </div>
      <p className="texto-suave">
        {p.para && `Para ${p.para} · `}Hecho el {fechaCorta(p.creadoEn)}
        {p.hechoPor && ` por ${p.hechoPor}`} · Vale hasta el {fechaCorta(p.venceEn)}
        {p.lista === 'gremio' && ' · Precios de gremio'}
      </p>
      {p.nota && <p>{p.nota}</p>}

      <div className="tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Cantidad</th>
              <th scope="col">Descripción</th>
              <th scope="col" className="num">
                Precio
              </th>
              <th scope="col" className="num">
                Importe
              </th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td>{formatearCantidad(i.cantidad, i.unidad)}</td>
                <td>{i.descripcion}</td>
                <td className="num">{formatearPlata(i.precioUnitario)}</td>
                <td className="num">{formatearPlata(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="num">
                <strong>{formatearPlata(p.total)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {errorAccion && <Aviso>{errorAccion}</Aviso>}
      <div className="acciones">
        {sePuedeVender && (
          <>
            <button
              type="button"
              className="m-boton m-boton--accion"
              onClick={() => vender(p.estado === 'vencido')}
            >
              {p.estado === 'vencido' ? 'Cobrar con los precios de hoy' : 'Cobrar'}
            </button>
            <button
              type="button"
              className="m-boton"
              onClick={() => vender(p.estado !== 'vencido')}
            >
              {p.estado === 'vencido'
                ? 'Cobrar con los precios del presupuesto'
                : 'Cobrar con los precios de hoy'}
            </button>
          </>
        )}
        <a
          className="m-boton boton-enlace"
          href={enlaceWhatsApp(textoWhatsApp(p, s.kiosco.nombre))}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mandar por WhatsApp
        </a>
        <button type="button" className="m-boton" onClick={imprimirPresupuesto}>
          Imprimir
        </button>
        {sePuedeVender && (
          <button type="button" className="m-boton m-boton--peligro" onClick={() => void anular()}>
            Anular
          </button>
        )}
      </div>
      <PresupuestoImpreso p={p} comercio={s.kiosco.nombre} />
    </div>
  );
}
