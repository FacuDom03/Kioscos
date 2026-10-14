import { DATOS_RUBROS } from '@mostrador/shared';
import { aplicarTema, leerTema, temasDeEstilo, type Tema } from '@mostrador/ui';
import { useState } from 'react';
import { Volver } from '../componentes/Formulario.tsx';
import { useNegocio } from '../nucleo/rubro.ts';

export function Apariencia({ alVolver }: { alVolver: () => void }) {
  const [tema, setTema] = useState<Tema>(leerTema);
  // El estilo sale del rubro del comercio; los temas que se ofrecen son los de ese estilo.
  const estilo = DATOS_RUBROS[useNegocio().rubro].estilo;

  const elegir = (t: Tema) => {
    setTema(t);
    aplicarTema(t);
  };

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo" id="titulo-apariencia">
        Apariencia
      </h1>
      <p className="texto-suave">
        Elegí cómo se ve la app en este equipo. Podés cambiarlo cuando quieras.
      </p>

      <div className="temas" role="radiogroup" aria-labelledby="titulo-apariencia">
        {temasDeEstilo(estilo).map((t) => (
          <label key={t.id} className="tema">
            <input
              type="radio"
              name="tema"
              value={t.id}
              checked={tema === t.id}
              onChange={() => elegir(t.id)}
              className="tema__radio"
            />
            <span className="tema__miniatura" data-tema={t.id} aria-hidden="true">
              <span className="tema__mosaico">
                <span className="tema__precio">$ 900</span>
              </span>
              <span className="tema__cartel" />
              <span className="tema__accion" />
            </span>
            <span className="tema__texto">
              <span className="tema__nombre">{t.nombre}</span>
              <span className="texto-suave">{t.descripcion}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="nota">
        {estilo === 'kiosco'
          ? 'En todos los temas, el amarillo marca precios y totales, y el rojo avisa problemas.'
          : 'En todos los temas, el rojo avisa problemas.'}
      </p>
    </div>
  );
}
