import { aplicarActualizacion, useHayVersionNueva } from '../nucleo/actualizacion.ts';
import { useTicket } from '../nucleo/ticket.ts';

export function BannerVersion() {
  const hay = useHayVersionNueva();
  const items = useTicket();
  if (!hay) return null;
  return (
    <p className="banner banner--version" role="status">
      <span>Hay una versión nueva de la app.</span>
      {items.length > 0 ? (
        <span className="texto-suave">Se actualiza cuando termines la venta.</span>
      ) : (
        <button type="button" className="m-boton" onClick={() => void aplicarActualizacion()}>
          Actualizar
        </button>
      )}
    </p>
  );
}
