import { useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso } from '../../componentes/Formulario.tsx';
import { abrirCaja } from '../../nucleo/turno.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';

export function AbrirCaja() {
  const s = useSesionCompleta();
  const [cambio, setCambio] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (cambio === null) return setError('Poné cuánto cambio hay en la caja (puede ser 0).');
    try {
      await abrirCaja(cambio);
    } catch {
      setError('No se pudo abrir la caja. Probá de nuevo.');
    }
  }
  return (
    <div className="pantalla">
      <h1 className="m-titulo">Abrir caja</h1>
      <p className="texto-suave">
        {s.kiosco.nombre} · {s.usuario.nombre}
      </p>
      <form className="formulario" onSubmit={enviar}>
        <CampoPlata
          etiqueta="¿Con cuánto cambio arrancás?"
          valor={cambio}
          alCambiar={setCambio}
          autoFocus
        />
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton m-boton--principal">Abrir caja</button>
      </form>
    </div>
  );
}
