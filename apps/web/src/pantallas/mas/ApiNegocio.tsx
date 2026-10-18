import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { avisar, confirmar } from '../../componentes/Dialogos.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

// API y automatizaciones (docs/API.md): claves de solo lectura para n8n, Make o Zapier, y avisos
// automáticos cuando pasa algo en el negocio. Solo el dueño entra acá.

interface Clave {
  id: string;
  nombre: string;
  prefijo: string;
  permisos: string[];
  ultimoUso: string | null;
  revocadaEn: string | null;
}

interface AvisoWeb {
  id: string;
  url: string;
  eventos: string[];
  activo: boolean;
  ultimoEnvio: string | null;
  ultimoEstado: string | null;
  fallosSeguidos: number;
}

const EVENTOS = [
  { id: 'venta.creada', nombre: 'Cada venta cobrada' },
  { id: 'venta.anulada', nombre: 'Cada venta anulada' },
  { id: 'compra.creada', nombre: 'Cada compra cargada' },
  { id: 'stock.bajo', nombre: 'Un producto llega al stock mínimo' },
] as const;

const nombreEvento = (id: string) =>
  ({
    'venta.creada': 'ventas',
    'venta.anulada': 'anulaciones',
    'compra.creada': 'compras',
    'stock.bajo': 'stock bajo',
  })[id] ?? id;

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Un dato que se muestra una sola vez, con el botón para copiarlo. */
function SoloUnaVez({
  titulo,
  valor,
  alCerrar,
}: {
  titulo: string;
  valor: string;
  alCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="aviso aviso--ok una-vez" role="status">
      <p>
        <strong>{titulo}</strong> Copialo ahora: por seguridad no se vuelve a mostrar.
      </p>
      <code className="enlace-copiable">{valor}</code>
      <div className="acciones">
        <button
          type="button"
          className="m-boton m-boton--principal"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(valor);
              setCopiado(true);
            } catch {
              await avisar('No se pudo copiar', 'Seleccioná el texto y copialo a mano.');
            }
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <button type="button" className="m-boton" onClick={alCerrar}>
          Ya lo guardé
        </button>
      </div>
    </div>
  );
}

export function ApiNegocio({ alVolver }: { alVolver: () => void }) {
  const claves = useDatos<Clave[]>('/api/v1/claves-api');
  const avisos = useDatos<AvisoWeb[]>('/api/v1/avisos');
  const [nueva, setNueva] = useState<{ titulo: string; valor: string } | null>(null);
  const [errorClave, setErrorClave] = useState<string | null>(null);
  const [errorAviso, setErrorAviso] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<{ id: string; texto: string } | null>(null);
  const origen = window.location.origin;

  async function crearClave(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const datos = new FormData(form);
    try {
      const r = await api<{ clave: string; nombre: string }>('POST', '/api/v1/claves-api', {
        nombre: String(datos.get('nombre') ?? ''),
        clientes: datos.get('clientes') === 'si',
      });
      setErrorClave(null);
      setNueva({ titulo: `Clave "${r.nombre}" creada.`, valor: r.clave });
      form.reset();
      await claves.recargar();
    } catch (e) {
      setErrorClave(mensajeDeError(e));
    }
  }

  async function revocar(c: Clave) {
    if (
      !(await confirmar({
        titulo: `¿Revocar la clave "${c.nombre}"?`,
        texto: 'La herramienta que la usa deja de entrar en el momento. No se puede deshacer.',
        aceptar: 'Revocar clave',
        peligro: true,
      }))
    )
      return;
    try {
      await api('DELETE', `/api/v1/claves-api/${c.id}`);
      await claves.recargar();
    } catch (e) {
      await avisar('No se pudo revocar la clave', mensajeDeError(e));
    }
  }

  async function crearAviso(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const datos = new FormData(form);
    const eventos = datos.getAll('eventos').map(String);
    if (!eventos.length) {
      setErrorAviso('Elegí al menos un momento para avisar.');
      return;
    }
    try {
      const r = await api<{ secreto: string }>('POST', '/api/v1/avisos', {
        url: String(datos.get('url') ?? '').trim(),
        eventos,
      });
      setErrorAviso(null);
      setNueva({
        titulo: 'Aviso agregado. Este es el secreto para verificar la firma.',
        valor: r.secreto,
      });
      form.reset();
      await avisos.recargar();
    } catch (e) {
      setErrorAviso(mensajeDeError(e));
    }
  }

  async function probar(a: AvisoWeb) {
    setPrueba({ id: a.id, texto: 'Mandando un aviso de prueba…' });
    try {
      const r = await api<{ enviado: boolean; estado: string }>(
        'POST',
        `/api/v1/avisos/${a.id}/probar`,
        {},
      );
      setPrueba({
        id: a.id,
        texto: r.enviado ? `Llegó bien. ${r.estado}.` : `No llegó: ${r.estado}`,
      });
      await avisos.recargar();
    } catch (e) {
      setPrueba({ id: a.id, texto: mensajeDeError(e) });
    }
  }

  async function cambiarActivo(a: AvisoWeb) {
    try {
      await api('PATCH', `/api/v1/avisos/${a.id}`, { activo: !a.activo });
      await avisos.recargar();
    } catch (e) {
      await avisar('No se pudo cambiar el aviso', mensajeDeError(e));
    }
  }

  async function quitar(a: AvisoWeb) {
    if (
      !(await confirmar({
        titulo: '¿Quitar este aviso?',
        texto: `Mostrador deja de mandar avisos a ${new URL(a.url).hostname}.`,
        aceptar: 'Quitar aviso',
        peligro: true,
      }))
    )
      return;
    try {
      await api('DELETE', `/api/v1/avisos/${a.id}`);
      await avisos.recargar();
    } catch (e) {
      await avisar('No se pudo quitar el aviso', mensajeDeError(e));
    }
  }

  const activas = claves.datos?.filter((c) => !c.revocadaEn) ?? [];
  const revocadas = claves.datos?.filter((c) => c.revocadaEn) ?? [];

  return (
    <div className="pantalla api-negocio">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">API y automatizaciones</h1>
      <p className="texto-suave">
        Conectá tu negocio con n8n, Make, Zapier o tu propio sistema. Pueden leer productos, ventas,
        compras y caja, pero no pueden cambiar nada.
      </p>

      {nueva && (
        <SoloUnaVez titulo={nueva.titulo} valor={nueva.valor} alCerrar={() => setNueva(null)} />
      )}

      <section className="conexion" aria-labelledby="titulo-claves">
        <h2 id="titulo-claves" className="subtitulo">
          Claves de acceso
        </h2>
        <p className="texto-suave">
          Cada herramienta usa su propia clave. Si dejás de usar una, revocala.
        </p>
        {claves.error && <Aviso>{claves.error}</Aviso>}
        {claves.datos && !activas.length && (
          <p className="vacio">Todavía no creaste ninguna clave.</p>
        )}
        <ul className="lista-filas">
          {activas.map((c) => (
            <li key={c.id} className="tarjeta">
              <div>
                <strong>{c.nombre}</strong>{' '}
                <span className="texto-suave enlace-copiable">{c.prefijo}…</span>
                <p className="texto-suave">
                  {c.permisos.includes('clientes')
                    ? 'Lee el negocio y los clientes'
                    : 'Lee el negocio, sin clientes'}
                  {' · '}
                  {c.ultimoUso ? `Último uso: ${fecha(c.ultimoUso)}` : 'Sin usar todavía'}
                </p>
              </div>
              <button type="button" className="m-boton m-boton--peligro" onClick={() => revocar(c)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
        {revocadas.length > 0 && (
          <details>
            <summary>Revocadas ({revocadas.length})</summary>
            <ul className="lista-filas">
              {revocadas.map((c) => (
                <li key={c.id} className="tarjeta tarjeta--apagada">
                  <span>
                    {c.nombre} <span className="texto-suave">{c.prefijo}…</span>
                  </span>
                  <span className="texto-suave">Revocada el {fecha(c.revocadaEn ?? '')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <form className="formulario" onSubmit={crearClave}>
          <h3 className="subtitulo">Crear una clave</h3>
          <Campo
            etiqueta="¿Para qué es?"
            name="nombre"
            placeholder="Por ejemplo: n8n del resumen diario"
            required
            maxLength={60}
          />
          <label className="opcion opcion--check">
            <input type="checkbox" name="clientes" value="si" />
            También puede ver los clientes de cuenta corriente (nombre, teléfono y deuda)
          </label>
          {errorClave && <Aviso>{errorClave}</Aviso>}
          <button className="m-boton m-boton--principal">Crear clave</button>
        </form>
      </section>

      <section className="conexion" aria-labelledby="titulo-avisos">
        <h2 id="titulo-avisos" className="subtitulo">
          Avisos automáticos
        </h2>
        <p className="texto-suave">
          Mostrador le avisa a tu herramienta en el momento en que pasa algo. Cada aviso va firmado
          para que sepa que es tuyo.
        </p>
        {avisos.error && <Aviso>{avisos.error}</Aviso>}
        {avisos.datos && !avisos.datos.length && <p className="vacio">Todavía no hay avisos.</p>}
        <ul className="lista-filas">
          {avisos.datos?.map((a) => (
            <li
              key={a.id}
              className={`tarjeta tarjeta--columna${a.activo ? '' : ' tarjeta--apagada'}`}
            >
              <div>
                <strong className="enlace-copiable">{a.url}</strong>
                <p className="texto-suave">Avisa: {a.eventos.map(nombreEvento).join(', ')}</p>
                <p className={a.activo ? 'texto-suave' : 'texto-peligro'}>
                  {!a.activo
                    ? a.fallosSeguidos > 0
                      ? 'Pausado: falló muchas veces seguidas. Revisá la dirección y activalo.'
                      : 'Pausado'
                    : a.ultimoEnvio
                      ? `Último aviso ${fecha(a.ultimoEnvio)}: ${a.ultimoEstado ?? ''}`
                      : 'Todavía no mandó avisos.'}
                </p>
                {prueba?.id === a.id && (
                  <p className="texto-suave" role="status">
                    {prueba.texto}
                  </p>
                )}
              </div>
              <div className="acciones">
                <button type="button" className="m-boton" onClick={() => probar(a)}>
                  Probar
                </button>
                <button type="button" className="m-boton" onClick={() => cambiarActivo(a)}>
                  {a.activo ? 'Pausar' : 'Activar'}
                </button>
                <button
                  type="button"
                  className="m-boton m-boton--peligro"
                  onClick={() => quitar(a)}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form className="formulario" onSubmit={crearAviso}>
          <h3 className="subtitulo">Agregar un aviso</h3>
          <Campo
            etiqueta="Dirección que recibe el aviso"
            name="url"
            type="url"
            inputMode="url"
            placeholder="https://"
            required
            maxLength={500}
            ayuda="La que te da n8n en el nodo Webhook, o Make y Zapier. Tiene que empezar con https://."
          />
          <fieldset className="campo">
            <legend>Avisar cuando…</legend>
            {EVENTOS.map((e) => (
              <label key={e.id} className="opcion opcion--check">
                <input
                  type="checkbox"
                  name="eventos"
                  value={e.id}
                  defaultChecked={e.id === 'venta.creada'}
                />
                {e.nombre}
              </label>
            ))}
          </fieldset>
          {errorAviso && <Aviso>{errorAviso}</Aviso>}
          <button className="m-boton m-boton--principal">Agregar aviso</button>
        </form>
      </section>

      <section className="conexion" aria-labelledby="titulo-n8n">
        <h2 id="titulo-n8n" className="subtitulo">
          Cómo conectarlo con n8n
        </h2>
        <ol className="pasos-api">
          <li>En n8n, agregá un nodo HTTP Request con el método GET.</li>
          <li>
            En la dirección poné, por ejemplo,{' '}
            <code className="enlace-copiable">{origen}/api/externa/v1/resumen</code> para el resumen
            del día.
          </li>
          <li>
            En los encabezados (Headers) agregá <code>Authorization</code> con el valor{' '}
            <code>Bearer</code>, un espacio y tu clave.
          </li>
          <li>
            Para recibir avisos, creá un nodo Webhook y pegá su dirección en Agregar un aviso.
          </li>
        </ol>
        <details>
          <summary>Qué se puede leer</summary>
          <ul className="lista-api">
            <li>
              <code>/api/externa/v1/resumen?dia=AAAA-MM-DD</code>: ventas, total y medios de pago
              del día.
            </li>
            <li>
              <code>/api/externa/v1/ventas?desde=…&amp;hasta=…</code> y{' '}
              <code>/api/externa/v1/ventas/ID</code>: ventas con sus productos y pagos.
            </li>
            <li>
              <code>/api/externa/v1/productos</code>: precios, stock y códigos. Con{' '}
              <code>?porReponer=si</code>, solo lo que hay que reponer.
            </li>
            <li>
              <code>/api/externa/v1/compras</code>: compras cargadas.
            </li>
            <li>
              <code>/api/externa/v1/clientes</code>: solo con una clave que tenga permiso de
              clientes.
            </li>
          </ul>
          <p className="texto-suave">
            Los importes vienen en centavos: 150000 son $ 1.500. Las listas traen hasta 100
            resultados; para seguir, usá <code>despues</code> con el valor de <code>siguiente</code>
            .
          </p>
        </details>
        <p className="texto-suave">
          La clave es como una contraseña: no la pegues en una página web ni la compartas.
        </p>
      </section>
    </div>
  );
}
