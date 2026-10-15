import { formatearCantidad, formatearPlata } from '@mostrador/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import {
  DIAS_CAMBIO,
  quedaParaCambiar,
  valorDevuelto,
  vencioElCambio,
  type VentaCambiable,
} from '../../nucleo/cambios.ts';
import { buscarProductos, productoPorCodigo, type Producto } from '../../nucleo/catalogo.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { iniciarCambio } from '../../nucleo/ticket.ts';

/**
 * Cambios (etapa I7): se busca la venta por el código del ticket de cambio o por el producto que
 * trae el cliente, se marca lo que devuelve y en Vender se suma lo que se lleva.
 */
export function Cambios() {
  const enLinea = useEnLinea();
  const [codigo, setCodigo] = useState('');
  const [q, setQ] = useState('');
  const [ventas, setVentas] = useState<VentaCambiable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const resultados = q.trim() ? buscarProductos(q, 6) : [];

  async function buscar(params: string) {
    setError(null);
    setElegida(null);
    setCantidades({});
    try {
      const r = await api<{ ventas: VentaCambiable[] }>('GET', `/api/v1/cambios/ventas?${params}`);
      setVentas(r.ventas);
      if (r.ventas.length === 1) setElegida(r.ventas[0]?.id ?? null);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  function porProducto(p: Producto) {
    setQ('');
    void buscar(`productoId=${p.id}`);
  }

  // El lector de códigos busca por el producto.
  useEffect(() => {
    const alLeer = (ev: Event) => {
      const p = productoPorCodigo((ev as CustomEvent<string>).detail);
      if (p) porProducto(p);
    };
    window.addEventListener('mostrador:codigo', alLeer);
    return () => window.removeEventListener('mostrador:codigo', alLeer);
  });

  function porCodigo(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const c = codigo.trim();
    if (!/^[0-9a-fA-F]{8}$/.test(c)) {
      setError('El código del ticket de cambio tiene 8 letras y números, por ejemplo 4F0C81A2.');
      return;
    }
    void buscar(`codigo=${c}`);
  }

  const venta = ventas?.find((v) => v.id === elegida);
  const devuelve = venta
    ? venta.items
        .filter((i) => (cantidades[i.id] ?? 0) > 0)
        .map((i) => ({
          itemId: i.id,
          descripcion: i.descripcion,
          cantidad: cantidades[i.id] ?? 0,
          importe: valorDevuelto(venta, i, cantidades[i.id] ?? 0),
        }))
    : [];
  const aFavor = devuelve.reduce((t, x) => t + x.importe, 0);

  function seguir() {
    if (!venta || !devuelve.length) return;
    iniciarCambio({ ventaId: venta.id, codigo: venta.codigo, items: devuelve });
    navegar('/');
  }

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/')} />
      <h1 className="m-titulo">Cambio</h1>
      <p className="texto-suave">
        Buscá la venta con el código del ticket de cambio o con el producto que trae. Después sumás
        lo que se lleva y se cobra la diferencia.
      </p>
      {!enLinea && <Aviso tipo="info">Para buscar la venta hace falta internet.</Aviso>}

      <div className="cambios__busqueda">
        <form className="formulario tarjeta-form" onSubmit={porCodigo}>
          <Campo
            etiqueta="Código del ticket de cambio"
            name="codigo"
            maxLength={8}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="4F0C81A2"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <button className="m-boton" disabled={!enLinea}>
            Buscar la venta
          </button>
        </form>
        <div className="formulario tarjeta-form">
          <Campo
            etiqueta="O el producto que trae"
            name="producto"
            type="search"
            autoComplete="off"
            placeholder="Escaneá o escribí"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {resultados.length > 0 && (
            <ul className="lista-filas" aria-label="Productos">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="fila"
                    disabled={!enLinea}
                    onClick={() => porProducto(p)}
                  >
                    <span className="fila__titulo">{p.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <Aviso>{error}</Aviso>}
      {ventas && ventas.length === 0 && (
        <p className="vacio">No encontramos ventas de los últimos 90 días con eso.</p>
      )}
      {ventas && ventas.length > 1 && !venta && (
        <ul className="lista-filas" aria-label="Ventas">
          {ventas.map((v) => (
            <li key={v.id}>
              <button type="button" className="fila" onClick={() => setElegida(v.id)}>
                <span className="fila__texto">
                  <span className="fila__titulo">
                    {new Date(v.creadaEn).toLocaleDateString('es-AR')} · Ticket {v.codigo}
                  </span>
                  <span className="texto-suave">
                    {v.items.map((i) => i.descripcion).join(', ')}
                  </span>
                </span>
                <span className="m-plata">{formatearPlata(v.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {venta && (
        <section className="tarjeta-form cambios__venta" aria-labelledby="titulo-venta-cambio">
          <h2 id="titulo-venta-cambio" className="subtitulo">
            Venta del {new Date(venta.creadaEn).toLocaleDateString('es-AR')} · Ticket {venta.codigo}
          </h2>
          {vencioElCambio(venta.creadaEn) && (
            <Aviso tipo="info">
              Esta venta es de hace más de {DIAS_CAMBIO} días: el ticket de cambio ya venció.
            </Aviso>
          )}
          <p className="texto-suave">¿Qué devuelve?</p>
          <ul className="lista-filas">
            {venta.items.map((i) => {
              const queda = quedaParaCambiar(i);
              const n = cantidades[i.id] ?? 0;
              const fijar = (x: number) =>
                setCantidades((c) => ({ ...c, [i.id]: Math.min(queda, Math.max(0, x)) }));
              return (
                <li key={i.id} className="fila">
                  <span className="fila__texto">
                    <span className="fila__titulo">{i.descripcion}</span>
                    <span className="texto-suave">
                      {queda > 0
                        ? `Llevó ${formatearCantidad(i.cantidad, i.unidad)} · Se pagó ${formatearPlata(valorDevuelto(venta, i, 1))} c/u`
                        : 'Ya se cambió'}
                    </span>
                  </span>
                  {queda > 0 && (
                    <span
                      className="cantidad-paso"
                      role="group"
                      aria-label={`Cuántos ${i.descripcion} devuelve`}
                    >
                      <button
                        type="button"
                        className="paso__boton"
                        aria-label={`Devolver uno menos de ${i.descripcion}`}
                        disabled={n === 0}
                        onClick={() => fijar(n - 1)}
                      >
                        −
                      </button>
                      <span className="m-plata" aria-live="polite">
                        {formatearCantidad(n)}
                      </span>
                      <button
                        type="button"
                        className="paso__boton"
                        aria-label={`Devolver uno más de ${i.descripcion}`}
                        disabled={n >= queda}
                        onClick={() => fijar(Number.isInteger(queda) ? n + 1 : queda)}
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="cambios__favor">
            A favor del cliente <strong className="m-plata">{formatearPlata(aFavor)}</strong>
          </p>
          <div className="acciones">
            <button
              type="button"
              className="m-boton m-boton--principal"
              disabled={!devuelve.length}
              onClick={seguir}
            >
              Elegir lo que se lleva
            </button>
            {ventas && ventas.length > 1 && (
              <button type="button" className="m-boton" onClick={() => setElegida(null)}>
                Era otra venta
              </button>
            )}
          </div>
          <p className="texto-suave">
            Lo que se lleva tiene que valer lo mismo o más: no se devuelve plata.
          </p>
        </section>
      )}
    </div>
  );
}
