import { useState } from 'react';
import { Aviso } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarMp, useEstadoMp } from '../../nucleo/mp.ts';
import { confirmar } from '../../componentes/Dialogos.tsx';

const ESTADOS = {
  conectado: 'Conectado',
  requiere_atencion: 'Requiere atención: volvé a conectar',
  desconectado: 'Sin conectar',
} as const;

export function TarjetaMp() {
  const mp = useEstadoMp();
  const resultado = new URLSearchParams(location.search).get('mp');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(
    resultado === 'ok'
      ? { tipo: 'ok', texto: 'Listo, Mercado Pago quedó conectado.' }
      : resultado === 'error'
        ? { tipo: 'error', texto: 'No se pudo conectar Mercado Pago. Probá de nuevo en un rato.' }
        : resultado === 'vencido'
          ? {
              tipo: 'error',
              texto: 'Se venció el tiempo para conectar. Tocá "Conectar Mercado Pago" de nuevo.',
            }
          : null,
  );

  if (!mp) return null;
  const estado = mp.estado;

  async function probar() {
    try {
      const r = await api<{ ok: boolean }>('POST', '/api/v1/mp/probar', {});
      setAviso(
        r.ok
          ? { tipo: 'ok', texto: 'La conexión anda bien. Ya podés cobrar con QR.' }
          : { tipo: 'error', texto: 'La conexión no anda. Volvé a conectar Mercado Pago.' },
      );
      await refrescarMp();
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    }
  }

  async function desconectar() {
    if (
      !(await confirmar({
        titulo: '¿Desconectar Mercado Pago?',
        texto: 'Ya no vas a poder cobrar con QR.',
        aceptar: 'Desconectar',
        peligro: true,
      }))
    )
      return;
    try {
      await api('POST', '/api/v1/mp/desconectar', {});
      await refrescarMp();
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
      return;
    }
    setAviso({
      tipo: 'ok',
      texto:
        'Desconectado. Para quitar el permiso del todo, entrá a tu cuenta de Mercado Pago → Seguridad → Aplicaciones conectadas y quitá Mostrador.',
    });
  }

  return (
    <section className="conexion">
      <div className="conexion__cabeza">
        <h2 className="subtitulo">Mercado Pago</h2>
        <span
          className={`conexion__estado ${estado === 'conectado' ? 'conexion__estado--ok' : estado === 'requiere_atencion' ? 'conexion__estado--mal' : ''}`}
        >
          {ESTADOS[estado]}
        </span>
      </div>
      <p className="texto-suave">
        Confirma al instante los cobros con QR. Nunca vemos tu contraseña ni movemos tu plata.
      </p>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {!mp.configurado ? (
        <p className="texto-suave">Todavía no está disponible en este servidor.</p>
      ) : estado === 'desconectado' || estado === 'requiere_atencion' ? (
        <a className="m-boton m-boton--accion boton-enlace" href="/api/v1/mp/conectar">
          Conectar Mercado Pago
        </a>
      ) : (
        <div className="acciones">
          <button type="button" className="m-boton" onClick={() => void probar()}>
            Probar conexión
          </button>
          <button
            type="button"
            className="m-boton m-boton--peligro"
            onClick={() => void desconectar()}
          >
            Desconectar
          </button>
        </div>
      )}
    </section>
  );
}
