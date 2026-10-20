import { cuitValido } from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { avisar, confirmar } from '../../componentes/Dialogos.tsx';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesion, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

// Facturación electrónica ARCA (docs/FACTURACION.md): se prende como una función del negocio.
// El comercio nunca nos da su clave fiscal: autoriza a Mostrador en ARCA y carga sus datos acá.

interface Config {
  cuit: string;
  razonSocial: string;
  condicion: 'monotributo' | 'exento' | 'responsable_inscripto';
  puntoVenta: number;
  domicilio: string;
  iibb: string | null;
  inicioActividades: string | null;
  estado: 'pendiente' | 'activa' | 'pausada' | 'desconectada' | 'suspendida' | 'baja';
  error: string | null;
  verificadaEn: string | null;
}

interface Estado {
  disponible: boolean;
  prueba: boolean;
  /** En pruebas, con el CUIT del comercio (ambiente de pruebas de ARCA). */
  cuitPropio: boolean;
  cuitMostrador: string;
  activo: boolean;
  config: Config | null;
  pendientes: number;
  rechazados: number;
}

const ESTADOS: Record<Config['estado'], { texto: string; detalle: string; ok: boolean }> = {
  activa: { texto: 'Activa', detalle: 'Cada venta cobrada sale con factura.', ok: true },
  pendiente: {
    texto: 'Esperando a ARCA',
    detalle: 'Cuando ARCA confirme la autorización a Mostrador, empieza a facturar sola.',
    ok: false,
  },
  pausada: { texto: 'En pausa', detalle: 'Las ventas no salen con factura.', ok: false },
  desconectada: {
    texto: 'Desconectada en ARCA',
    detalle: 'ARCA no tiene la autorización a Mostrador. Revisá el paso 2 de la guía.',
    ok: false,
  },
  suspendida: {
    texto: 'Suspendida',
    detalle: 'Mostrador suspendió la facturación de este comercio. Escribinos.',
    ok: false,
  },
  baja: { texto: 'Sin facturar', detalle: 'Dejaste de facturar.', ok: false },
};

const formatearCuit = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

export function Facturacion({ alVolver }: { alVolver: () => void }) {
  const s = useSesionCompleta();
  const { recargar: recargarSesion } = useSesion();
  const { datos, error, recargar } = useDatos<Estado>('/api/v1/facturacion');
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'info' | 'error'; texto: string } | null>(null);
  const dueno = s.rol === 'dueno';

  async function prender() {
    try {
      await api('PUT', '/api/v1/facturacion/modulo', { activo: true });
      await recargarSesion();
      await recargar();
    } catch (e) {
      await avisar('No se pudo activar', mensajeDeError(e));
    }
  }

  async function probar() {
    setAviso({ tipo: 'info', texto: 'Probando con ARCA…' });
    try {
      const r = await api<{ activa: boolean; mensaje: string | null }>(
        'POST',
        '/api/v1/facturacion/verificar',
        {},
      );
      setAviso(
        r.activa
          ? { tipo: 'ok', texto: 'Listo: ARCA responde y la facturación está activa.' }
          : { tipo: 'info', texto: r.mensaje ?? 'Todavía no se puede facturar.' },
      );
      await recargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    }
  }

  async function cambiarEstado(estado: 'pausada' | 'activa' | 'baja') {
    if (
      estado === 'baja' &&
      !(await confirmar({
        titulo: '¿Dejar de facturar?',
        texto:
          'Las ventas dejan de salir con factura y lo pendiente no sale. Las facturas emitidas siguen en ARCA. Si querés, después quitá la autorización a Mostrador en ARCA.',
        aceptar: 'Dejar de facturar',
        peligro: true,
      }))
    )
      return;
    try {
      await api('POST', '/api/v1/facturacion/estado', { estado });
      setAviso(null);
      await recargar();
    } catch (e) {
      await avisar('No se pudo cambiar', mensajeDeError(e));
    }
  }

  if (error)
    return (
      <div className="pantalla">
        <Volver onClick={alVolver} />
        <Aviso>{error}</Aviso>
      </div>
    );
  if (!datos)
    return (
      <div className="pantalla">
        <Volver onClick={alVolver} />
        <p className="texto-suave" aria-busy="true">
          Cargando…
        </p>
      </div>
    );

  const c = datos.config;
  const conDatos = c && c.estado !== 'baja';
  const estado = c ? ESTADOS[c.estado] : null;

  return (
    <div className="pantalla facturacion">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Facturación ARCA</h1>

      {!datos.disponible && (
        <Aviso tipo="info">
          La facturación todavía no está habilitada en Mostrador. Avisanos por WhatsApp.
        </Aviso>
      )}
      {datos.disponible && datos.prueba && (
        <Aviso tipo="info">
          {datos.cuitPropio
            ? 'Ambiente de pruebas de ARCA: las facturas salen con tu CUIT pero no valen. Sirve para probar todo antes de facturar de verdad.'
            : 'Modo de prueba: las facturas salen con el CUIT de pruebas de ARCA y no valen. Sirve para ver cómo funciona antes de facturar de verdad.'}
        </Aviso>
      )}

      {!datos.activo ? (
        <section className="conexion">
          <p>
            Cada venta cobrada sale con su factura electrónica, sin hacer nada más. Al anular una
            venta, sale la nota de crédito.
          </p>
          <p className="texto-suave">
            No nos das tu clave fiscal: en ARCA autorizás a Mostrador solo para facturar, y lo podés
            quitar cuando quieras.
          </p>
          {dueno ? (
            <button
              type="button"
              className="m-boton m-boton--principal"
              disabled={!datos.disponible}
              onClick={() => void prender()}
            >
              Activar facturación
            </button>
          ) : (
            <p className="texto-suave">La activa el dueño.</p>
          )}
        </section>
      ) : (
        <>
          {conDatos && estado && !editando && (
            <section className="conexion" aria-labelledby="titulo-estado">
              <div className="conexion__cabeza">
                <h2 id="titulo-estado" className="subtitulo">
                  Estado
                </h2>
                <span
                  className={`conexion__estado ${estado.ok ? 'conexion__estado--ok' : 'conexion__estado--mal'}`}
                >
                  {estado.texto}
                </span>
              </div>
              <p className="texto-suave">{estado.detalle}</p>
              {c.error && c.estado !== 'activa' && <Aviso tipo="info">{c.error}</Aviso>}
              {(datos.pendientes > 0 || datos.rechazados > 0) && (
                <p>
                  {datos.pendientes > 0 &&
                    `${datos.pendientes} ${datos.pendientes === 1 ? 'factura' : 'facturas'} por salir. `}
                  {datos.rechazados > 0 && (
                    <>
                      {datos.rechazados} sin poder facturar.{' '}
                      <button
                        type="button"
                        className="enlace-boton"
                        onClick={() => navegar('/ventas')}
                      >
                        Ver en Ventas
                      </button>
                    </>
                  )}
                </p>
              )}
              {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
              {dueno && (
                <div className="acciones">
                  {c.estado !== 'suspendida' && (
                    <button type="button" className="m-boton" onClick={() => void probar()}>
                      Probar ahora
                    </button>
                  )}
                  {c.estado === 'activa' && (
                    <button
                      type="button"
                      className="m-boton"
                      onClick={() => void cambiarEstado('pausada')}
                    >
                      Pausar
                    </button>
                  )}
                  {c.estado === 'pausada' && (
                    <button
                      type="button"
                      className="m-boton m-boton--principal"
                      onClick={() => void cambiarEstado('activa')}
                    >
                      Reanudar
                    </button>
                  )}
                  {c.estado !== 'suspendida' && (
                    <button
                      type="button"
                      className="m-boton m-boton--peligro"
                      onClick={() => void cambiarEstado('baja')}
                    >
                      Dejar de facturar
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {conDatos && !editando && (
            <section className="conexion" aria-labelledby="titulo-datos">
              <div className="conexion__cabeza">
                <h2 id="titulo-datos" className="subtitulo">
                  Datos fiscales
                </h2>
                {dueno && c.estado !== 'suspendida' && (
                  <button type="button" className="m-boton" onClick={() => setEditando(true)}>
                    Editar
                  </button>
                )}
              </div>
              <dl className="datos-fiscales">
                <dt>CUIT</dt>
                <dd>{formatearCuit(c.cuit)}</dd>
                <dt>Razón social</dt>
                <dd>{c.razonSocial}</dd>
                <dt>Condición</dt>
                <dd>{c.condicion === 'monotributo' ? 'Monotributo' : 'Exento'}</dd>
                <dt>Punto de venta</dt>
                <dd>{c.puntoVenta}</dd>
                <dt>Domicilio</dt>
                <dd>{c.domicilio}</dd>
                {c.iibb && (
                  <>
                    <dt>Ingresos brutos</dt>
                    <dd>{c.iibb}</dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {(!conDatos || editando || c?.estado === 'pendiente') && (
            <Guia cuitMostrador={datos.cuitMostrador} prueba={datos.prueba && !datos.cuitPropio} />
          )}

          {dueno && (!conDatos || editando) && (
            <FormularioFiscal
              inicial={c}
              alCancelar={conDatos ? () => setEditando(false) : undefined}
              alGuardar={async (r) => {
                setEditando(false);
                setAviso(
                  r.activa
                    ? { tipo: 'ok', texto: 'Listo: la facturación está activa.' }
                    : { tipo: 'info', texto: r.mensaje ?? 'Quedó esperando a ARCA.' },
                );
                await recargar();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Los pasos en ARCA, en orden. */
function Guia({ cuitMostrador, prueba }: { cuitMostrador: string; prueba: boolean }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <section className="conexion" aria-labelledby="titulo-guia">
      <h2 id="titulo-guia" className="subtitulo">
        Qué hacer en ARCA (una sola vez)
      </h2>
      {prueba && (
        <p className="texto-suave">
          En modo de prueba no hace falta hacer esto todavía: cargá tus datos y probá.
        </p>
      )}
      <ol className="pasos-api">
        <li>
          <strong>Creá un punto de venta</strong> en ARCA → "Administración de puntos de venta y
          domicilios". Elegí "Factura Electrónica – Monotributo – Web Services" (o "Exento – Web
          Services"). No sirve uno de "Factura en línea". Anotá el número.
        </li>
        <li>
          <strong>Autorizá a Mostrador</strong> en ARCA → "Administrador de Relaciones de Clave
          Fiscal" → "Nueva relación" → ARCA → WebServices → Facturación Electrónica. Como
          representante, poné el CUIT de Mostrador
          {cuitMostrador ? (
            <>
              : <code className="enlace-copiable">{formatearCuit(cuitMostrador)}</code>{' '}
              <button
                type="button"
                className="enlace-boton"
                onClick={() =>
                  void navigator.clipboard.writeText(cuitMostrador).then(() => setCopiado(true))
                }
              >
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </>
          ) : (
            ' (te lo pasamos por WhatsApp)'
          )}
          . Si aparece un aviso de "computador fiscal", es normal: confirmá igual. Hace falta clave
          fiscal nivel 3.
        </li>
        <li>
          <strong>Cargá tus datos acá abajo.</strong> Mostrador acepta la autorización y la
          facturación se activa sola. Nunca te pedimos la clave fiscal.
        </li>
      </ol>
    </section>
  );
}

function FormularioFiscal({
  inicial,
  alGuardar,
  alCancelar,
}: {
  inicial: Config | null;
  alGuardar: (r: { activa: boolean; mensaje: string | null }) => Promise<void>;
  alCancelar: (() => void) | undefined;
}) {
  const [condicion, setCondicion] = useState(inicial?.condicion ?? 'monotributo');
  const [errorCuit, setErrorCuit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const texto = (k: string) => String(f.get(k) ?? '').trim();
    const cuit = texto('cuit').replace(/\D/g, '');
    if (!cuitValido(cuit)) {
      setErrorCuit('Revisá el CUIT: son 11 números y el último no coincide.');
      return;
    }
    setErrorCuit(null);
    setError(null);
    setGuardando(true);
    try {
      const r = await api<{ activa: boolean; mensaje: string | null }>(
        'POST',
        '/api/v1/facturacion/config',
        {
          cuit,
          razonSocial: texto('razonSocial'),
          condicion,
          puntoVenta: Number(texto('puntoVenta')),
          domicilio: texto('domicilio'),
          ...(texto('iibb') ? { iibb: texto('iibb') } : {}),
          ...(texto('inicio') ? { inicioActividades: texto('inicio') } : {}),
        },
      );
      await alGuardar(r);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="formulario tarjeta-form" onSubmit={enviar}>
      <h2 className="subtitulo">Tus datos fiscales</h2>
      <Campo
        etiqueta="CUIT"
        name="cuit"
        inputMode="numeric"
        placeholder="20-12345678-6"
        defaultValue={inicial ? formatearCuit(inicial.cuit) : ''}
        error={errorCuit}
        required
      />
      <Campo
        etiqueta="Razón social o nombre"
        name="razonSocial"
        defaultValue={inicial?.razonSocial ?? ''}
        maxLength={120}
        required
      />
      <div className="campo">
        <label htmlFor="fiscal-condicion">Condición frente al IVA</label>
        <select
          id="fiscal-condicion"
          className="campo__entrada"
          value={condicion}
          onChange={(e) => setCondicion(e.target.value as Config['condicion'])}
        >
          <option value="monotributo">Monotributo</option>
          <option value="exento">Exento</option>
          <option value="responsable_inscripto" disabled>
            Responsable inscripto (muy pronto)
          </option>
        </select>
      </div>
      <Campo
        etiqueta="Punto de venta (Web Services)"
        name="puntoVenta"
        inputMode="numeric"
        defaultValue={inicial?.puntoVenta ?? ''}
        pattern="\d{1,5}"
        required
      />
      <Campo
        etiqueta="Domicilio comercial"
        name="domicilio"
        defaultValue={inicial?.domicilio ?? ''}
        maxLength={200}
        placeholder="Av. Siempreviva 742, Ramos Mejía, Buenos Aires (1704)"
        ayuda="Calle y número, localidad, provincia y código postal, como figura en ARCA para este punto de venta. Sale impreso en el ticket."
        required
      />
      <Campo
        etiqueta="Ingresos brutos (opcional)"
        name="iibb"
        defaultValue={inicial?.iibb ?? ''}
        maxLength={30}
      />
      <Campo
        etiqueta="Inicio de actividades (opcional)"
        name="inicio"
        type="date"
        defaultValue={inicial?.inicioActividades ?? ''}
      />
      {error && <Aviso>{error}</Aviso>}
      <div className="acciones">
        <button className="m-boton m-boton--principal" disabled={guardando}>
          {guardando ? 'Probando con ARCA…' : 'Guardar y probar'}
        </button>
        {alCancelar && (
          <button type="button" className="m-boton" onClick={alCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
