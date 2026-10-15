import { useState, type FormEvent } from 'react';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { mensajeDeError } from '../../nucleo/api.ts';
import { enDias, guardarPresupuesto } from '../../nucleo/presupuestos.ts';

/** Guarda el ticket como presupuesto (pide para quién y hasta cuándo vale). */
export function GuardarPresupuesto({
  alCerrar,
  alGuardar,
}: {
  alCerrar: () => void;
  alGuardar: (r: { id: string; numero: number }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setEnviando(true);
    setError(null);
    try {
      alGuardar(
        await guardarPresupuesto({
          para: String(f.get('para') ?? '').trim(),
          nota: String(f.get('nota') ?? '').trim(),
          venceEn: String(f.get('vence') ?? enDias(15)),
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <dialog
      className="dialogo"
      open
      aria-labelledby="titulo-presupuesto"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          alCerrar();
        }
      }}
    >
      <form className="formulario" onSubmit={enviar}>
        <h2 id="titulo-presupuesto" className="subtitulo">
          Guardar presupuesto
        </h2>
        <Campo
          etiqueta="Para quién (opcional)"
          name="para"
          maxLength={80}
          autoComplete="off"
          autoFocus
          placeholder="Por ejemplo, obra de calle 9"
        />
        <Campo
          etiqueta="Vale hasta"
          name="vence"
          type="date"
          min={enDias(0)}
          max={enDias(365)}
          defaultValue={enDias(15)}
          required
        />
        <Campo etiqueta="Nota (opcional)" name="nota" maxLength={300} autoComplete="off" />
        {error && <Aviso>{error}</Aviso>}
        <div className="acciones">
          <button className="m-boton m-boton--principal" disabled={enviando}>
            Guardar
          </button>
          <button type="button" className="m-boton" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
