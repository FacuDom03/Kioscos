import { TEMAS, leerTema } from '@mostrador/ui';

export function Mas({ alAbrirApariencia }: { alAbrirApariencia: () => void }) {
  const actual = TEMAS.find((t) => t.id === leerTema())?.nombre;
  return (
    <div className="pantalla">
      <h1 className="m-titulo">Más</h1>
      <ul className="lista-filas">
        <li>
          <button type="button" className="fila" onClick={alAbrirApariencia}>
            <span>Apariencia</span>
            <span className="texto-suave">
              {actual} <span aria-hidden="true">›</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}
