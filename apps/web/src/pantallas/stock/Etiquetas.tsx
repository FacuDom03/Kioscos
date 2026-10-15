import { DATOS_UNIDADES, formatearPlata, type Unidad } from '@mostrador/shared';

export interface Etiqueta {
  nombre: string;
  precio: number;
  unidad?: Unidad | undefined;
  codigo?: string;
}

/** Imprime las etiquetas de góndola (hoja A4) en lugar del ticket. */
export function imprimirEtiquetas(): void {
  const raiz = document.documentElement;
  raiz.classList.add('imprimiendo-etiquetas');
  window.addEventListener('afterprint', () => raiz.classList.remove('imprimiendo-etiquetas'), {
    once: true,
  });
  window.print();
}

/** Etiquetas de precio para el estante. Solo se ven al imprimir. */
export function Etiquetas({ items }: { items: Etiqueta[] }) {
  const hoy = new Date().toLocaleDateString('es-AR');
  return (
    <div className="etiquetas-impresion" aria-hidden="true">
      {items.map((e, i) => (
        <div key={`${e.codigo ?? ''}-${i}`} className="etiqueta">
          <p className="etiqueta__nombre">{e.nombre}</p>
          <p className="etiqueta__precio">
            {formatearPlata(e.precio)}
            {e.unidad && e.unidad !== 'unidad' && (
              <span className="etiqueta__unidad"> {DATOS_UNIDADES[e.unidad].precioPor}</span>
            )}
          </p>
          <p className="etiqueta__pie">
            {e.codigo && <span>{e.codigo}</span>}
            <span>{hoy}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
