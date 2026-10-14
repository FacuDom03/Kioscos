import { useEffect, useRef, useState } from 'react';
import { Aviso } from './Formulario.tsx';

interface Props {
  alLeer: (codigo: string) => void;
  alCerrar: () => void;
}

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

interface Detector {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (o: { formats: string[] }): Detector;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/**
 * Escaneo con la cámara del celular o la tablet (sección 14.2). Usa BarcodeDetector si existe;
 * si no, ZXing (se carga recién cuando se usa). Ignora el mismo código durante 1,5 segundos.
 */
export function Escaner({ alLeer, alCerrar }: Props) {
  const [paso, setPaso] = useState<'explicacion' | 'camara' | 'error'>('explicacion');
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const ultimo = useRef<{ codigo: string; t: number }>({ codigo: '', t: 0 });
  const leer = useRef(alLeer);
  useEffect(() => {
    leer.current = alLeer;
  }, [alLeer]);

  useEffect(() => {
    if (paso !== 'camara') return;
    let flujo: MediaStream | null = null;
    let parar = () => {};
    let vigente = true;

    const avisar = (codigo: string) => {
      const ahora = Date.now();
      if (codigo === ultimo.current.codigo && ahora - ultimo.current.t < 1500) return;
      ultimo.current = { codigo, t: ahora };
      navigator.vibrate?.(60);
      leer.current(codigo);
    };

    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!vigente || !video.current) return;
        video.current.srcObject = flujo;
        await video.current.play();
        const Nativo = window.BarcodeDetector;
        const soportados = Nativo?.getSupportedFormats ? await Nativo.getSupportedFormats() : [];
        if (Nativo && FORMATOS.some((f) => soportados.includes(f))) {
          const det = new Nativo({ formats: FORMATOS.filter((f) => soportados.includes(f)) });
          const t = setInterval(async () => {
            if (!video.current) return;
            const r = await det.detect(video.current).catch(() => []);
            if (r[0]?.rawValue) avisar(r[0].rawValue);
          }, 250);
          parar = () => clearInterval(t);
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const lector = new BrowserMultiFormatReader();
          const controles = await lector.decodeFromVideoElement(video.current, (r) => {
            if (r) avisar(r.getText());
          });
          parar = () => controles.stop();
        }
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'No diste permiso para usar la cámara. Activalo en la configuración del navegador, o escribí el código.'
            : 'No se pudo abrir la cámara en este navegador. Escribí el código o usá un lector.',
        );
        setPaso('error');
      }
    })();

    return () => {
      vigente = false;
      parar();
      for (const pista of flujo?.getTracks() ?? []) pista.stop();
    };
  }, [paso]);

  return (
    <dialog
      className="dialogo escaner"
      open
      aria-labelledby="titulo-escaner"
      onKeyDown={(e) => e.key === 'Escape' && alCerrar()}
    >
      <h2 id="titulo-escaner" className="subtitulo">
        Escanear
      </h2>
      {paso === 'explicacion' && (
        <>
          <p>
            Vamos a usar la cámara para leer los códigos de barras. Cuando el navegador pregunte,
            tocá "Permitir".
          </p>
          <div className="acciones">
            <button
              type="button"
              className="m-boton m-boton--principal"
              onClick={() => setPaso('camara')}
            >
              Abrir la cámara
            </button>
            <button type="button" className="m-boton" onClick={alCerrar}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {paso === 'camara' && (
        <>
          <video
            ref={video}
            className="escaner__video"
            muted
            playsInline
            aria-label="Vista de la cámara"
          />
          <p className="texto-suave">Apuntá al código. Cada producto leído se suma al ticket.</p>
          <button type="button" className="m-boton m-boton--principal" onClick={alCerrar}>
            Listo
          </button>
        </>
      )}
      {paso === 'error' && (
        <>
          <Aviso>{error}</Aviso>
          <button type="button" className="m-boton" onClick={alCerrar}>
            Cerrar
          </button>
        </>
      )}
    </dialog>
  );
}
