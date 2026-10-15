import {
  DATOS_MODULOS,
  DATOS_RUBROS,
  RUBROS,
  nombreModulo,
  tituloListo,
  type Modulo,
  type Rubro,
  moduloEnPlan,
} from '@mostrador/shared';
import { Toldo } from '@mostrador/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { aplicarRubro, rubroDe } from '../../nucleo/rubro.ts';
import { useSesion, useSesionCompleta } from '../../nucleo/sesion.tsx';

const ICONOS: Record<Rubro, string> = {
  kiosco: 'M4 11h20M5 11l2-6h14l2 6M6 11v12h16V11M11 23v-6h6v6',
  almacen: 'M14 5v17M9 22h10M6 8h16M6 8l-3 7h6zM22 8l-3 7h6z',
  ferreteria: 'M14 3l9 5.2v10.4L14 24l-9-5.4V8.2zM18 13.5a4 4 0 1 1-8 0a4 4 0 1 1 8 0z',
  perfumeria: 'M11 3h6v4h-6zM9 9h10a2 2 0 0 1 2 2v12H7V11a2 2 0 0 1 2-2zM11 16h6',
  libreria: 'M4 6h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4zM24 6h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z',
  otro: 'M9 14a2 2 0 1 1-4 0a2 2 0 1 1 4 0zM16 14a2 2 0 1 1-4 0a2 2 0 1 1 4 0zM23 14a2 2 0 1 1-4 0a2 2 0 1 1 4 0z',
};

function IconoRubro({ rubro }: { rubro: Rubro }) {
  return (
    <svg
      className="rubro__icono"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONOS[rubro]} />
    </svg>
  );
}

const sugeridas = (r: Rubro) =>
  new Set(DATOS_RUBROS[r].categorias.filter((c) => c.activa).map((c) => c.nombre));

/**
 * Rubro, categorías y funciones del comercio. Al entrar por primera vez, el dueño confirma el
 * rubro que marcó quien lo visitó (paso 1) y elige con qué arrancar (paso 2). Después se usa
 * desde Más para cambiarlo.
 */
export function ArmarNegocio({ alVolver }: { alVolver?: () => void }) {
  const s = useSesionCompleta();
  const { recargar } = useSesion();
  const enAlta = !alVolver;
  const actual = rubroDe(s.kiosco.rubro);
  const [paso, setPaso] = useState<'rubro' | 'armado'>(enAlta ? 'rubro' : 'armado');
  const [rubro, setRubro] = useState<Rubro>(actual);
  const [categorias, setCategorias] = useState<Set<string>>(() =>
    enAlta ? sugeridas(actual) : new Set(),
  );
  // Lo que el plan no incluye no se ofrece activado (el servidor tampoco lo acepta).
  const enPlan = (ms: readonly Modulo[]) => ms.filter((m) => moduloEnPlan(m, s.kiosco.plan));
  const [modulos, setModulos] = useState<Set<Modulo>>(
    () => new Set(enPlan(enAlta ? DATOS_RUBROS[actual].modulos : (s.kiosco.modulos ?? []))),
  );
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const datos = DATOS_RUBROS[rubro];
  // Vista previa: el diseño cambia al elegir el rubro.
  useEffect(() => aplicarRubro(rubro), [rubro]);

  function elegir(r: Rubro) {
    setRubro(r);
    const mismo = !enAlta && r === actual;
    setCategorias(mismo ? new Set() : sugeridas(r));
    setModulos(new Set(enPlan(mismo ? (s.kiosco.modulos ?? []) : DATOS_RUBROS[r].modulos)));
  }

  function alternar<T>(conjunto: Set<T>, valor: T, fijar: (c: Set<T>) => void) {
    const nuevo = new Set(conjunto);
    if (nuevo.has(valor)) nuevo.delete(valor);
    else nuevo.add(valor);
    fijar(nuevo);
  }

  async function guardar() {
    setError(null);
    setEnviando(true);
    try {
      await api('PUT', '/api/v1/kiosco/negocio', {
        rubro,
        modulos: [...modulos],
        categorias: datos.categorias.map((c) => c.nombre).filter((n) => categorias.has(n)),
      });
      await recargar();
      alVolver?.();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  function volver() {
    aplicarRubro(actual);
    alVolver?.();
  }

  const pasoRubro = (
    <>
      <h1 className="m-titulo">¿Qué tipo de negocio tenés?</h1>
      <p className="texto-suave">
        {enAlta && 'Lo marcó quien te visitó. Si no es, cambialo. '}Cada rubro tiene su diseño y sus
        funciones.
      </p>
      <fieldset className="rubros">
        <legend className="m-solo-lectores">Rubro</legend>
        {RUBROS.map((r) => (
          <label key={r} className="rubro">
            <input
              type="radio"
              name="rubro"
              value={r}
              checked={rubro === r}
              onChange={() => elegir(r)}
              className="rubro__radio"
            />
            <IconoRubro rubro={r} />
            <span className="rubro__nombre">{DATOS_RUBROS[r].nombre}</span>
            <span className="texto-suave rubro__detalle">{DATOS_RUBROS[r].descripcion}</span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className="m-boton m-boton--principal"
        onClick={() => setPaso('armado')}
      >
        Seguir con {rubro === 'otro' ? 'otro rubro' : datos.nombre.toLowerCase()}
      </button>
    </>
  );

  const pasoArmado = (
    <>
      <h1 className="m-titulo">{enAlta ? tituloListo(rubro) : 'Tu negocio'}</h1>
      <p className="texto-suave">
        {enAlta
          ? 'Dejamos activado lo que más se usa en tu rubro. Lo cambiás cuando quieras desde Más.'
          : `Rubro: ${datos.nombre}.`}
      </p>
      <button type="button" className="enlace-boton" onClick={() => setPaso('rubro')}>
        Cambiar rubro
      </button>

      {datos.categorias.length > 0 && (
        <fieldset className="armado__grupo">
          <legend className="armado__titulo">
            {enAlta ? 'Categorías para empezar' : 'Sumar categorías'}
          </legend>
          <div className="chips">
            {datos.categorias.map((c) => (
              <label key={c.nombre} className="chip chip--check">
                <input
                  type="checkbox"
                  checked={categorias.has(c.nombre)}
                  onChange={() => alternar(categorias, c.nombre, setCategorias)}
                />
                {c.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="armado__grupo">
        <legend className="armado__titulo">Funciones</legend>
        <ul className="funciones">
          {datos.ofrecidos.map((m) => (
            <li key={m}>
              <label className="funcion">
                <span className="funcion__texto">
                  <span className="funcion__nombre">{nombreModulo(rubro, m)}</span>
                  <span className="texto-suave">{DATOS_MODULOS[m].descripcion}</span>
                  {!DATOS_MODULOS[m].disponible && (
                    <span className="funcion__pronto">Estamos terminándola</span>
                  )}
                  {!moduloEnPlan(m, s.kiosco.plan) && (
                    <span className="funcion__pronto">Viene con el plan Comercio</span>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="funcion__check"
                  checked={modulos.has(m)}
                  disabled={!moduloEnPlan(m, s.kiosco.plan)}
                  onChange={() => alternar(modulos, m, setModulos)}
                />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && <Aviso>{error}</Aviso>}
      <button
        type="button"
        className="m-boton m-boton--principal"
        disabled={enviando}
        onClick={() => void guardar()}
      >
        {enAlta ? 'Empezar' : 'Guardar'}
      </button>
    </>
  );

  const contenido = paso === 'rubro' ? pasoRubro : pasoArmado;

  if (!enAlta) {
    return (
      <div className="pantalla armado">
        <Volver onClick={volver} />
        {contenido}
      </div>
    );
  }
  return <MarcoAlta paso={paso === 'rubro' ? 1 : 2}>{contenido}</MarcoAlta>;
}

function MarcoAlta({ paso, children }: { paso: 1 | 2; children: ReactNode }) {
  return (
    <div className="acceso">
      <Toldo />
      <main className="acceso__contenido armado" id="contenido">
        <p className="acceso__marca armado__marca">
          <span>Mostrador</span>
          <span className="armado__paso">Paso {paso} de 2</span>
        </p>
        {children}
      </main>
    </div>
  );
}
