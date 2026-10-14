import { useState } from 'react';
import { Aviso } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useSesion } from '../../nucleo/sesion.tsx';
import { MarcoAcceso } from './Acceso.tsx';

export interface PersonasEquipo {
  dispositivo: { nombre: string; kiosco: string } | null;
  personas: { id: string; nombre: string }[];
}

/** Ingreso del cajero con PIN, solo en un equipo autorizado por el dueño. */
export function IngresoPin({
  equipo,
  alUsarEmail,
}: {
  equipo: PersonasEquipo;
  alUsarEmail: () => void;
}) {
  const { recargar } = useSesion();
  const [persona, setPersona] = useState<string | null>(
    equipo.personas.length === 1 ? (equipo.personas[0]?.id ?? null) : null,
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function entrar(valor: string) {
    if (!persona) return;
    try {
      await api('POST', '/api/v1/auth/pin', { membresiaId: persona, pin: valor });
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e));
      setPin('');
    }
  }

  const tocar = (d: string) => {
    setError(null);
    const nuevo = (pin + d).slice(0, 6);
    setPin(nuevo);
  };

  const nombre = equipo.personas.find((p) => p.id === persona)?.nombre;

  return (
    <MarcoAcceso titulo={equipo.dispositivo?.kiosco ?? 'Entrar'}>
      {!persona ? (
        <>
          <p>¿Quién atiende?</p>
          <ul className="lista-filas">
            {equipo.personas.map((p) => (
              <li key={p.id}>
                <button type="button" className="fila" onClick={() => setPersona(p.id)}>
                  {p.nombre}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form
          className="formulario"
          onSubmit={(ev) => {
            ev.preventDefault();
            void entrar(pin);
          }}
        >
          <p>
            Hola, <strong>{nombre}</strong>. Poné tu PIN.
          </p>
          <label className="m-solo-lectores" htmlFor="pin">
            PIN
          </label>
          <input
            id="pin"
            className="pin__pantalla"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            maxLength={6}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
          />
          <div className="pin__teclado">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" className="m-boton pin__tecla" onClick={() => tocar(d)}>
                {d}
              </button>
            ))}
            <button
              type="button"
              className="m-boton pin__tecla"
              onClick={() => setPin(pin.slice(0, -1))}
              aria-label="Borrar"
            >
              ⌫
            </button>
            <button type="button" className="m-boton pin__tecla" onClick={() => tocar('0')}>
              0
            </button>
            <button className="m-boton pin__tecla pin__tecla--ok" disabled={pin.length < 4}>
              Entrar
            </button>
          </div>
          {error && <Aviso>{error}</Aviso>}
          {equipo.personas.length > 1 && (
            <button type="button" className="enlace-boton" onClick={() => setPersona(null)}>
              No soy {nombre}
            </button>
          )}
        </form>
      )}
      <button type="button" className="enlace-boton" onClick={alUsarEmail}>
        Entrar con email (dueño o encargado)
      </button>
    </MarcoAcceso>
  );
}
