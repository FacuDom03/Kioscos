import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { TarjetaMp } from './TarjetaMp.tsx';
import { useBandeja } from '../../nucleo/bandeja.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { navegar } from '../../nucleo/ruta.ts';

interface Kiosco {
  soporte_hasta: string | null;
}

export function Conexiones({
  alVolver,
  alAbrirApariencia,
}: {
  alVolver: () => void;
  alAbrirApariencia: () => void;
}) {
  const { datos, recargar } = useDatos<Kiosco>('/api/v1/kiosco');
  const [error, setError] = useState<string | null>(null);
  const soporte = !!datos?.soporte_hasta;
  const bandeja = useBandeja();
  const negocio = useNegocio();
  const [ahora] = useState(() => Date.now());
  const hace = bandeja.ultimaSubida
    ? Math.max(0, Math.round((ahora - new Date(bandeja.ultimaSubida).getTime()) / 60_000))
    : null;

  async function cambiarSoporte() {
    try {
      await api('PUT', '/api/v1/kiosco/soporte', { activo: !soporte });
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Conexiones</h1>
      {error && <Aviso>{error}</Aviso>}

      <TarjetaMp />

      <section className="conexion">
        <div className="conexion__cabeza">
          <h2 className="subtitulo">Copia en la nube</h2>
          <span
            className={`conexion__estado ${bandeja.pendientes ? 'conexion__estado--mal' : 'conexion__estado--ok'}`}
          >
            {bandeja.pendientes ? `${bandeja.pendientes} sin subir` : 'Al día'}
          </span>
        </div>
        <p className="texto-suave">
          Ventas, stock y caja se guardan solos. Si se rompe el celular, no perdés nada.
        </p>
        <p className="texto-suave">
          {hace === null
            ? 'Este equipo todavía no subió ventas.'
            : hace === 0
              ? 'Última copia: recién.'
              : `Última copia: hace ${hace} ${hace === 1 ? 'minuto' : 'minutos'}.`}
        </p>
      </section>

      <section className="conexion">
        <div className="conexion__cabeza">
          <h2 className="subtitulo">Acceso de soporte</h2>
          <button
            type="button"
            role="switch"
            aria-checked={soporte}
            aria-label="Acceso de soporte"
            className="interruptor"
            onClick={cambiarSoporte}
          >
            <span className="interruptor__texto">{soporte ? 'Prendido' : 'Apagado'}</span>
          </button>
        </div>
        <p className="texto-suave">
          Prendelo solo si te lo pedimos. Se apaga solo a las 24 horas y ves todo lo que hicimos.
        </p>
        {soporte && datos?.soporte_hasta && (
          <p className="texto-suave">
            Se apaga solo el {new Date(datos.soporte_hasta).toLocaleString('es-AR')}.
          </p>
        )}
      </section>

      <section className="conexion">
        <div className="conexion__cabeza">
          <h2 className="subtitulo">Facturación ARCA</h2>
          <button type="button" className="m-boton" onClick={() => navegar('/mas/facturacion')}>
            {negocio.tiene('facturacion') ? 'Ver' : 'Activar'}
          </button>
        </div>
        <p className="texto-suave">
          Cada venta sale con factura electrónica. Sin darnos tu clave fiscal.
        </p>
      </section>

      <button type="button" className="fila" onClick={alAbrirApariencia}>
        <span>Apariencia</span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
