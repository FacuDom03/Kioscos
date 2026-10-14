import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

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

      <section className="conexion conexion--proximamente">
        <h2 className="subtitulo">Facturación ARCA</h2>
        <p className="texto-suave">Próximamente.</p>
      </section>

      <button type="button" className="fila" onClick={alAbrirApariencia}>
        <span>Apariencia</span>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
