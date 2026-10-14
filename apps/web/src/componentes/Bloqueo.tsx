import { useEffect, useState, type FormEvent } from 'react';
import { hayPinLocal, verificarPinLocal } from '../nucleo/bloqueo.ts';
import { useSesion } from '../nucleo/sesion.tsx';
import { Aviso } from './Formulario.tsx';

const MINUTOS = 5;

/** Pantalla de bloqueo del cajero después de unos minutos sin usar la app. */
export function Bloqueo({ kioscoId, nombre }: { kioscoId: string; nombre: string }) {
  const { salir } = useSesion();
  const [bloqueado, setBloqueado] = useState(false);
  const [intentos, setIntentos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const reiniciar = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (await hayPinLocal(kioscoId)) setBloqueado(true);
      }, MINUTOS * 60_000);
    };
    const eventos = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of eventos) window.addEventListener(e, reiniciar, { passive: true });
    reiniciar();
    return () => {
      clearTimeout(t);
      for (const e of eventos) window.removeEventListener(e, reiniciar);
    };
  }, [kioscoId]);

  if (!bloqueado) return null;

  async function destrabar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const pin = String(new FormData(ev.currentTarget).get('pin') ?? '');
    if (await verificarPinLocal(kioscoId, pin)) {
      setBloqueado(false);
      setIntentos(0);
      setError(null);
      return;
    }
    const n = intentos + 1;
    setIntentos(n);
    if (n >= 5) {
      // Demasiados intentos: se cierra la sesión (las ventas sin subir quedan guardadas).
      await salir();
      return;
    }
    setError('PIN incorrecto.');
    ev.currentTarget.reset();
  }

  return (
    <div className="bloqueo" role="dialog" aria-modal="true" aria-labelledby="titulo-bloqueo">
      <form className="formulario bloqueo__caja" onSubmit={destrabar}>
        <h1 id="titulo-bloqueo" className="m-titulo">
          Pantalla bloqueada
        </h1>
        <p>{nombre}, poné tu PIN para seguir.</p>
        <label className="m-solo-lectores" htmlFor="pin-bloqueo">
          PIN
        </label>
        <input
          id="pin-bloqueo"
          name="pin"
          className="pin__pantalla"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          autoFocus
        />
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton m-boton--principal">Seguir</button>
      </form>
    </div>
  );
}
