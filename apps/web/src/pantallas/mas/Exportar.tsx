import { useState, type FormEvent } from 'react';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { borrarDatosDelKiosco } from '../../nucleo/local.ts';
import { useSesion, useSesionCompleta } from '../../nucleo/sesion.tsx';

const hoy = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const primeroDelMes = () => `${hoy().slice(0, 8)}01`;

async function descargar(url: string, nombre: string) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('No se pudo descargar. Probá de nuevo.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Exportar({ alVolver }: { alVolver: () => void }) {
  const s = useSesionCompleta();
  const { salir } = useSesion();
  const [desde, setDesde] = useState(primeroDelMes);
  const [hasta, setHasta] = useState(hoy);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  const bajar = (tipo: 'ventas' | 'compras') =>
    descargar(
      `/api/v1/exportar/${tipo}.csv?desde=${desde}&hasta=${hasta}`,
      `${tipo}-${desde}-a-${hasta}.csv`,
    ).catch((e: unknown) => setError(mensajeDeError(e)));

  async function borrar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget)) as {
      nombreKiosco: string;
      password: string;
    };
    if (
      !confirm(
        'Esto borra todas las ventas, el stock y la caja del kiosco. No se puede deshacer. ¿Seguro?',
      )
    )
      return;
    try {
      await api('POST', '/api/v1/kiosco/borrar', f);
      await borrarDatosDelKiosco(s.kiosco.id);
      await salir();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Exportar datos</h1>
      {error && <Aviso>{error}</Aviso>}
      <section className="tarjeta-form">
        <h2 className="subtitulo">Para el contador</h2>
        <p className="texto-suave">Archivos CSV que abren en Excel.</p>
        <div className="dos-columnas">
          <Campo
            etiqueta="Desde"
            type="date"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
          />
          <Campo
            etiqueta="Hasta"
            type="date"
            value={hasta}
            min={desde}
            max={hoy()}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        <div className="acciones">
          <button
            type="button"
            className="m-boton m-boton--accion"
            onClick={() => void bajar('ventas')}
          >
            Descargar ventas
          </button>
          <button type="button" className="m-boton" onClick={() => void bajar('compras')}>
            Descargar compras
          </button>
        </div>
      </section>

      <section className="tarjeta-form">
        <h2 className="subtitulo">Todos los datos</h2>
        <p className="texto-suave">
          Productos, ventas, caja y compras en un solo archivo, para guardar o llevarte.
        </p>
        <button
          type="button"
          className="m-boton"
          onClick={() =>
            void descargar('/api/v1/exportar/todo.json', `mostrador-datos-${hoy()}.json`).catch(
              (e: unknown) => setError(mensajeDeError(e)),
            )
          }
        >
          Descargar todos los datos
        </button>
      </section>

      <section className="tarjeta-form zona-peligro">
        <h2 className="subtitulo">Borrar la cuenta</h2>
        {!borrando ? (
          <button
            type="button"
            className="m-boton m-boton--peligro"
            onClick={() => setBorrando(true)}
          >
            Borrar todos los datos del kiosco
          </button>
        ) : (
          <form className="formulario" onSubmit={borrar}>
            <p>
              Antes descargá tus datos. Para confirmar, escribí el nombre del kiosco (
              {s.kiosco.nombre}) y tu contraseña.
            </p>
            <Campo etiqueta="Nombre del kiosco" name="nombreKiosco" required autoComplete="off" />
            <Campo
              etiqueta="Tu contraseña"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
            <button className="m-boton m-boton--peligro">Borrar todo</button>
          </form>
        )}
      </section>
    </div>
  );
}
