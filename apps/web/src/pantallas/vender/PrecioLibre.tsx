import { useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { sumarPrecioLibre } from '../../nucleo/ticket.ts';

export function PrecioLibre({ alCerrar }: { alCerrar: () => void }) {
  const [monto, setMonto] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!monto) return setError('Poné el monto.');
    sumarPrecioLibre(monto, String(new FormData(ev.currentTarget).get('descripcion') ?? '').trim());
    alCerrar();
  }
  return (
    <dialog
      className="dialogo"
      open
      aria-labelledby="titulo-libre"
      onKeyDown={(e) => e.key === 'Escape' && alCerrar()}
    >
      <form className="formulario" onSubmit={enviar}>
        <h2 id="titulo-libre" className="subtitulo">
          Producto sin código
        </h2>
        <CampoPlata etiqueta="Monto" valor={monto} alCambiar={setMonto} autoFocus />
        <Campo
          etiqueta="Descripción (opcional)"
          name="descripcion"
          maxLength={120}
          placeholder="Por ejemplo, fiambre"
        />
        {error && <Aviso>{error}</Aviso>}
        <div className="acciones">
          <button className="m-boton m-boton--principal">Sumar al ticket</button>
          <button type="button" className="m-boton" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
