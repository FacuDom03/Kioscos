import { diaArgentino, diaCorto, formatearPlata, reglaPromo } from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo, useCatalogo } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

type Estado = 'corriendo' | 'programada' | 'terminada' | 'apagada';

interface Fila {
  id: string;
  nombre: string;
  lleva: number;
  paga: number;
  descuento: number;
  alcance: string;
  desde: string | null;
  hasta: string | null;
  activa: boolean;
  estado: Estado;
  descontado30: number;
  ventas30: number;
}

const ESTADOS: Record<Estado, string> = {
  corriendo: 'Corriendo',
  programada: 'Programada',
  terminada: 'Terminada',
  apagada: 'Apagada',
};

/** Reglas listas para elegir; "otra" deja poner los números. */
const REGLAS = [
  { id: '3x2', nombre: '3x2', lleva: 3, paga: 2, descuento: 100 },
  { id: '2x1', nombre: '2x1', lleva: 2, paga: 1, descuento: 100 },
  { id: '2da50', nombre: '2da al 50%', lleva: 2, paga: 1, descuento: 50 },
  { id: '2da70', nombre: '2da con 70% menos', lleva: 2, paga: 1, descuento: 70 },
  { id: 'otra', nombre: 'Otra', lleva: 4, paga: 3, descuento: 100 },
] as const;

/** Promos automáticas (etapa I7): se aplican solas en Vender, también sin conexión. */
export function Promos({ alVolver }: { alVolver: () => void }) {
  const { catalogo } = useCatalogo();
  const { datos, error, recargar } = useDatos<Fila[]>('/api/v1/promos');
  const [regla, setRegla] = useState<(typeof REGLAS)[number]['id']>('3x2');
  const [numeros, setNumeros] = useState({ lleva: 4, paga: 3, descuento: 100 });
  const [alcance, setAlcance] = useState('');
  const [nombre, setNombre] = useState('');
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const elegida = REGLAS.find((r) => r.id === regla) ?? REGLAS[0];
  const n = regla === 'otra' ? numeros : elegida;
  const [tipo, id] = alcance.split(':');
  const nombreAlcance =
    tipo === 'g'
      ? catalogo?.grupos?.find((g) => g.id === id)?.nombre
      : catalogo?.categorias.find((c) => c.id === id)?.nombre;
  const sugerido = nombreAlcance ? `${reglaPromo(n)} en ${nombreAlcance.toLowerCase()}` : '';

  async function crear(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    if (!id) return setErrorAlta('Elegí a qué se aplica.');
    const desde = String(f.get('desde') ?? '');
    const hasta = String(f.get('hasta') ?? '');
    setErrorAlta(null);
    try {
      await api('POST', '/api/v1/promos', {
        nombre: (nombre.trim() || sugerido).slice(0, 80),
        lleva: n.lleva,
        paga: n.paga,
        descuento: n.descuento,
        ...(tipo === 'g' ? { grupoId: id } : { categoriaId: id }),
        ...(desde ? { desde } : {}),
        ...(hasta ? { hasta } : {}),
      });
      setNombre('');
      setAviso('Promo creada. Ya se aplica en Vender.');
      await recargar();
      await refrescarCatalogo().catch(() => undefined);
    } catch (e) {
      setErrorAlta(mensajeDeError(e));
    }
  }

  async function cambiar(p: Fila, cambios: { activa?: boolean; hasta?: string }) {
    setAviso(null);
    try {
      await api('PATCH', `/api/v1/promos/${p.id}`, cambios);
      await recargar();
      await refrescarCatalogo().catch(() => undefined);
    } catch (e) {
      setErrorAlta(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Promos</h1>
      <p className="texto-suave">
        Se aplican solas en Vender cuando el ticket cumple la regla. Las unidades más baratas son
        las que llevan el descuento.
      </p>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {datos && datos.length === 0 && <p className="vacio">Todavía no hay promos.</p>}
      {datos && datos.length > 0 && (
        <ul className="lista-filas">
          {datos.map((p) => (
            <li key={p.id} className="fila fila--promo">
              <span className="fila__texto">
                <span className="fila__titulo">{p.nombre}</span>
                <span className="texto-suave">
                  {reglaPromo(p)} · {p.alcance}
                  {p.desde && ` · desde el ${diaCorto(p.desde)}`}
                  {p.hasta && ` · hasta el ${diaCorto(p.hasta)}`}
                </span>
                {p.ventas30 > 0 && (
                  <span className="texto-suave">
                    Descontó {formatearPlata(p.descontado30)} en {p.ventas30}{' '}
                    {p.ventas30 === 1 ? 'venta' : 'ventas'} (30 días)
                  </span>
                )}
              </span>
              <span className="fila__derecha">
                <span className={`estado-promo estado-promo--${p.estado}`}>
                  {ESTADOS[p.estado]}
                </span>
                {p.activa ? (
                  <button
                    type="button"
                    className="m-boton"
                    onClick={() => void cambiar(p, { activa: false })}
                  >
                    Apagar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="m-boton"
                    onClick={() => void cambiar(p, { activa: true })}
                  >
                    Prender
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="formulario tarjeta-form" onSubmit={crear}>
        <h2 className="subtitulo">Nueva promo</h2>
        <fieldset className="campo">
          <legend>Regla</legend>
          <div className="chips" role="group">
            {REGLAS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="chip"
                aria-pressed={regla === r.id}
                onClick={() => setRegla(r.id)}
              >
                {r.nombre}
              </button>
            ))}
          </div>
        </fieldset>
        {regla === 'otra' && (
          <div className="dos-columnas">
            <Campo
              etiqueta="Cada cuántas unidades"
              type="number"
              min={2}
              max={12}
              value={numeros.lleva}
              onChange={(e) => setNumeros((x) => ({ ...x, lleva: Number(e.target.value) }))}
            />
            <Campo
              etiqueta="Cuántas a precio lleno"
              type="number"
              min={1}
              max={11}
              value={numeros.paga}
              onChange={(e) => setNumeros((x) => ({ ...x, paga: Number(e.target.value) }))}
            />
            <Campo
              etiqueta="Descuento del resto (%)"
              type="number"
              min={1}
              max={100}
              value={numeros.descuento}
              onChange={(e) => setNumeros((x) => ({ ...x, descuento: Number(e.target.value) }))}
            />
          </div>
        )}
        <div className="campo">
          <label htmlFor="alcance-promo">¿A qué se aplica?</label>
          <select
            id="alcance-promo"
            className="campo__entrada"
            value={alcance}
            onChange={(e) => setAlcance(e.target.value)}
          >
            <option value="">Elegí…</option>
            {(catalogo?.grupos?.length ?? 0) > 0 && (
              <optgroup label="Productos con tonos y tamaños (todos juntos)">
                {catalogo?.grupos?.map((g) => (
                  <option key={g.id} value={`g:${g.id}`}>
                    {g.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Categorías">
              {catalogo?.categorias.map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.nombre}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <Campo
          etiqueta="Nombre (sale en el ticket)"
          maxLength={80}
          value={nombre}
          placeholder={sugerido || '3x2 en esmaltes'}
          onChange={(e) => setNombre(e.target.value)}
        />
        <div className="dos-columnas">
          <Campo etiqueta="Desde (opcional)" name="desde" type="date" min={diaArgentino()} />
          <Campo etiqueta="Hasta (opcional)" name="hasta" type="date" min={diaArgentino()} />
        </div>
        <p className="texto-suave">
          La regla no se cambia después (las ventas sin internet se revisan con ella): si querés
          otra, apagás esta y creás una nueva.
        </p>
        {errorAlta && <Aviso>{errorAlta}</Aviso>}
        <button className="m-boton m-boton--principal">Crear promo</button>
      </form>
      <button type="button" className="enlace-boton" onClick={() => navegar('/')}>
        Ir a vender
      </button>
    </div>
  );
}
