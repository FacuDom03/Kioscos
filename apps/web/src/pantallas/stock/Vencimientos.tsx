import { diaCorto, formatearCantidad, sumarDias } from '@mostrador/shared';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { useState } from 'react';

interface Lote {
  id: string;
  productoId: string;
  nombre: string;
  stock: number;
  venceEn: string;
  cantidad: number;
  vencido: boolean;
}

/** Vencimientos por lote (etapa I7): lo vencido arriba, después lo que vence antes. */
export function Vencimientos() {
  const s = useSesionCompleta();
  const editar = puede.editarCatalogo(s.rol);
  const { datos, error, recargar } = useDatos<{ hoy: string; lotes: Lote[] }>(
    '/api/v1/vencimientos?dias=90',
  );
  const [errorRetiro, setErrorRetiro] = useState<string | null>(null);

  async function retirar(id: string) {
    setErrorRetiro(null);
    try {
      await api('POST', `/api/v1/lotes/${id}/retirar`, {});
      await recargar();
    } catch (e) {
      setErrorRetiro(mensajeDeError(e));
    }
  }

  const grupos = datos
    ? [
        { titulo: 'Vencidos', lotes: datos.lotes.filter((l) => l.vencido) },
        {
          titulo: 'Vencen en los próximos 30 días',
          lotes: datos.lotes.filter((l) => !l.vencido && l.venceEn <= sumarDias(datos.hoy, 30)),
        },
        {
          titulo: 'Vencen en 31 a 90 días',
          lotes: datos.lotes.filter((l) => l.venceEn > sumarDias(datos.hoy, 30)),
        },
      ]
    : [];

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Vencimientos</h1>
      <p className="texto-suave">
        Cada vez que entra mercadería con fecha, cargá el lote en la ficha del producto. Cuando ya
        no queda nada de ese lote, marcalo.
      </p>
      {error && <Aviso>{error}</Aviso>}
      {errorRetiro && <Aviso>{errorRetiro}</Aviso>}
      {datos && datos.lotes.length === 0 && (
        <p className="vacio">No vence nada en los próximos 90 días.</p>
      )}
      {grupos
        .filter((g) => g.lotes.length)
        .map((g) => (
          <section key={g.titulo} aria-label={g.titulo}>
            <h2 className="subtitulo">{g.titulo}</h2>
            <ul className="lista-filas">
              {g.lotes.map((l) => (
                <li key={l.id} className="fila">
                  <button
                    type="button"
                    className="fila__texto enlace-fila"
                    onClick={() => navegar(`/stock/producto/${l.productoId}`)}
                  >
                    <span className="fila__titulo">{l.nombre}</span>
                    <span className={l.vencido ? 'texto-alerta' : 'texto-suave'}>
                      {l.vencido ? 'Venció' : 'Vence'} el {diaCorto(l.venceEn)} · Entraron{' '}
                      {formatearCantidad(l.cantidad)} · Quedan {formatearCantidad(l.stock)} en total
                    </span>
                  </button>
                  {editar && (
                    <button type="button" className="m-boton" onClick={() => void retirar(l.id)}>
                      Ya no queda
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
