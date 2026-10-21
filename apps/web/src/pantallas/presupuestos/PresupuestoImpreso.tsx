import { formatearCantidad, formatearPlata } from '@mostrador/shared';
import { fechaCorta, type Presupuesto } from '../../nucleo/presupuestos.ts';
import { imprimirEnHoja } from '../../nucleo/equipo.ts';
import { LogoImpreso, MarcaDeAgua, PieImpreso } from '../../componentes/Marca.tsx';

/** Imprime en hoja A4 el presupuesto que esté en pantalla. */
export function imprimirPresupuesto(): void {
  imprimirEnHoja('imprimiendo-presupuesto');
}

/** Presupuesto para imprimir en A4. Solo se ve al imprimir. */
export function PresupuestoImpreso({ p, comercio }: { p: Presupuesto; comercio: string }) {
  return (
    <div className="presupuesto-impreso" aria-hidden="true">
      <MarcaDeAgua />
      <header className="presupuesto-impreso__cabeza">
        <LogoImpreso className="presupuesto-impreso__logo" />
        <p className="presupuesto-impreso__comercio">{comercio}</p>
        <p>
          <strong>Presupuesto {p.numero}</strong> · {fechaCorta(p.creadoEn)}
        </p>
      </header>
      {p.para && <p>Para: {p.para}</p>}
      <table>
        <thead>
          <tr>
            <th>Cantidad</th>
            <th>Descripción</th>
            <th>Precio</th>
            <th>Importe</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.id}>
              <td>{formatearCantidad(i.cantidad, i.unidad)}</td>
              <td>{i.descripcion}</td>
              <td>{formatearPlata(i.precioUnitario)}</td>
              <td>{formatearPlata(i.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="presupuesto-impreso__total">Total {formatearPlata(p.total)}</p>
      {p.lista === 'gremio' && <p>Precios de gremio.</p>}
      <p>Vale hasta el {fechaCorta(p.venceEn)}. No es un comprobante fiscal.</p>
      {p.nota && <p>{p.nota}</p>}
      <PieImpreso className="presupuesto-impreso__pie" />
    </div>
  );
}
