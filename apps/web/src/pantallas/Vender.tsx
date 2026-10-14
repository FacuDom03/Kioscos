import { CartelTotal, Ticket } from '@mostrador/ui';
import type { ReactNode } from 'react';
import { useSesionCompleta } from '../nucleo/sesion.tsx';

// Pantalla inicial, todavía sin catálogo ni ticket (Etapa A). Muestra la estructura en los tres
// tamaños: una columna en celular; productos a la izquierda y ticket a la derecha en tablet y PC.
export function Vender({ estado }: { estado: ReactNode }) {
  const s = useSesionCompleta();
  return (
    <div className="vender">
      <header className="vender__encabezado">
        <div>
          <h1 className="m-titulo">{s.kiosco.nombre}</h1>
          <p className="texto-suave">Atiende {s.usuario.nombre || 'vos'}</p>
        </div>
        <div className="vender__estado">{estado}</div>
      </header>

      <div className="vender__columnas">
        <section className="vender__productos" aria-labelledby="titulo-mas-vendidos">
          <div className="buscador">
            <label className="m-solo-lectores" htmlFor="buscar">
              Buscar producto
            </label>
            <input
              id="buscar"
              className="buscador__campo"
              type="search"
              placeholder="Buscar producto"
            />
            <button type="button" className="buscador__escanear">
              Escanear
            </button>
            <span className="buscador__pista">Escaneá o escribí · F2</span>
          </div>
          <h2 id="titulo-mas-vendidos" className="subtitulo">
            Más vendidos
          </h2>
          <p className="vacio">Todavía no hay productos. Cargalos desde Stock.</p>
        </section>

        <aside className="vender__ticket" aria-label="Ticket y total">
          <Ticket etiqueta="Ticket">
            <h2 className="ticket__titulo">Ticket · 0 productos</h2>
            <hr className="m-ticket__separador" />
            <p className="ticket__vacio">El ticket está vacío.</p>
          </Ticket>
          <div className="vender__total">
            <CartelTotal centavos={0} />
          </div>
          <button type="button" className="m-boton m-boton--principal" disabled>
            Cobrar
          </button>
        </aside>
      </div>
    </div>
  );
}
