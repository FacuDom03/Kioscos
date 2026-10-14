import { Aviso } from '../../componentes/Formulario.tsx';
import type { VentaHecha } from '../../nucleo/cobrar.ts';

/** Cobro con QR de Mercado Pago (Etapa F). Hasta conectar Mercado Pago, avisa cómo hacerlo. */
export function CobroQr({
  alCancelar,
}: {
  total: number;
  alCobrado: (v: VentaHecha) => void;
  alCancelar: () => void;
}) {
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
