import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { puntoEnVideo, recorteDelMarco } from '@mostrador/shared';
import { Aviso } from './Formulario.tsx';

interface Props {
  alLeer: (codigo: string) => void;
  alCerrar: () => void;
}

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
/** Ancho máximo del recorte que se analiza: más no mejora la lectura y hace lento al celular. */
const ANCHO_MAXIMO = 1280;
/** Pausa entre un intento de lectura y el siguiente (ms). */
const PAUSA = 150;
/**
 * Con una cámara de al menos esta resolución (lado corto), la imagen se muestra al doble. Así,
 * a 15 cm el código ya llena el marco y nadie acerca el celular hasta desenfocarlo.
 */
const LADO_PARA_AGRANDAR = 900;

interface Detector {
  detect(fuente: HTMLCanvasElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (o: { formats: string[] }): Detector;
      getSupportedFormats?: () => Promise<string[]>;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

// Enfoque y linterna todavía no están en los tipos del navegador (Image Capture).
interface Capacidades extends MediaTrackCapabilities {
  focusMode?: string[];
  torch?: boolean;
}
interface Ajuste extends MediaTrackConstraintSet {
  focusMode?: string;
  torch?: boolean;
  pointsOfInterest?: { x: number; y: number }[];
}

function capacidades(pista: MediaStreamTrack | null): Capacidades {
  if (!pista || typeof pista.getCapabilities !== 'function') return {};
  return pista.getCapabilities();
}

/** Si enfoca en el punto tocado. Chrome lo avisa en la configuración, no en las capacidades. */
function enfocaEnPunto(pista: MediaStreamTrack): boolean {
  return typeof pista.getSettings === 'function' && 'pointsOfInterest' in pista.getSettings();
}

async function ajustar(pista: MediaStreamTrack, ajuste: Ajuste): Promise<boolean> {
  try {
    await pista.applyConstraints({ advanced: [ajuste] });
    return true;
  } catch {
    return false;
  }
}

type Detectar = (lienzo: HTMLCanvasElement) => Promise<string | null>;

/** BarcodeDetector si el navegador lo trae; si no, ZXing (se carga recién cuando se usa). */
async function crearDetector(): Promise<Detectar> {
  const Nativo = window.BarcodeDetector;
  const soportados = Nativo?.getSupportedFormats ? await Nativo.getSupportedFormats() : [];
  const formatos = FORMATOS.filter((f) => soportados.includes(f));
  if (Nativo && formatos.length > 0) {
    const det = new Nativo({ formats: formatos });
    return async (lienzo) => (await det.detect(lienzo).catch(() => []))[0]?.rawValue ?? null;
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const lector = new BrowserMultiFormatReader(
    new Map([
      [
        DecodeHintType.POSSIBLE_FORMATS,
        [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
        ],
      ],
    ]),
  );
  return async (lienzo) => {
    try {
      return lector.decodeFromCanvas(lienzo).getText();
    } catch {
      return null;
    }
  };
}

/** Sonido corto al leer. Se crea al tocar "Abrir la cámara" porque el iPhone lo exige. */
function crearAudio(): AudioContext | null {
  const Contexto = window.AudioContext ?? window.webkitAudioContext;
  try {
    return Contexto ? new Contexto() : null;
  } catch {
    return null;
  }
}

function pitar(audio: AudioContext | null) {
  if (!audio) return;
  const tono = audio.createOscillator();
  const volumen = audio.createGain();
  tono.frequency.value = 1800;
  volumen.gain.value = 0.08;
  tono.connect(volumen).connect(audio.destination);
  tono.start();
  tono.stop(audio.currentTime + 0.08);
}

function detener(flujo: MediaStream | null) {
  for (const pista of flujo?.getTracks() ?? []) pista.stop();
}

/**
 * Escaneo con la cámara del celular o la tablet (sección 14.2). Lee solo lo que cae dentro del
 * marco, con la cámara en alta resolución y enfoque continuo donde se pueda. La guía de
 * distancia es para el iPhone, que no enfoca de muy cerca. Ignora el mismo código durante
 * 1,5 segundos.
 */
export function Escaner({ alLeer, alCerrar }: Props) {
  const [paso, setPaso] = useState<'explicacion' | 'camara' | 'error'>('explicacion');
  const [error, setError] = useState<string | null>(null);
  const [funciones, setFunciones] = useState({ linterna: false, enfocar: false });
  const [linterna, setLinterna] = useState(false);
  const [leido, setLeido] = useState<string | null>(null);
  const [destello, setDestello] = useState(false);
  const [foco, setFoco] = useState<{ x: number; y: number } | null>(null);
  const [agrandar, setAgrandar] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const marco = useRef<HTMLDivElement>(null);
  const pista = useRef<MediaStreamTrack | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const ultimo = useRef<{ codigo: string; t: number }>({ codigo: '', t: 0 });
  const leer = useRef(alLeer);
  useEffect(() => {
    leer.current = alLeer;
  }, [alLeer]);

  const esperas = useRef(new Set<ReturnType<typeof setTimeout>>());
  const despues = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      esperas.current.delete(t);
      fn();
    }, ms);
    esperas.current.add(t);
  }, []);
  useEffect(() => {
    const pendientes = esperas.current;
    return () => {
      for (const t of pendientes) clearTimeout(t);
      void audio.current?.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (paso !== 'camara') return;
    let flujo: MediaStream | null = null;
    let vigente = true;
    let siguiente: ReturnType<typeof setTimeout> | undefined;

    const avisar = (codigo: string) => {
      const ahora = Date.now();
      if (codigo === ultimo.current.codigo && ahora - ultimo.current.t < 1500) return;
      ultimo.current = { codigo, t: ahora };
      navigator.vibrate?.(60);
      pitar(audio.current);
      setLeido(codigo);
      setDestello(true);
      despues(600, () => setDestello(false));
      leer.current(codigo);
    };

    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!vigente || !video.current) {
          detener(flujo);
          return;
        }
        const camara = flujo.getVideoTracks()[0] ?? null;
        pista.current = camara;
        const cap = capacidades(camara);
        if (camara && cap.focusMode?.includes('continuous')) {
          await ajustar(camara, { focusMode: 'continuous' });
        }
        setFunciones({
          linterna: cap.torch === true,
          enfocar: !!cap.focusMode?.includes('single-shot') || (!!camara && enfocaEnPunto(camara)),
        });
        video.current.srcObject = flujo;
        await video.current.play();
        setAgrandar(
          Math.min(video.current.videoWidth, video.current.videoHeight) >= LADO_PARA_AGRANDAR,
        );
        const detectar = await crearDetector();
        const lienzo = document.createElement('canvas');
        const dibujo = lienzo.getContext('2d', { willReadFrequently: true });
        if (!dibujo) throw new Error('Sin lienzo');

        const ciclo = async () => {
          const v = video.current;
          const m = marco.current;
          try {
            if (v && m && v.videoWidth > 0) {
              // El rectángulo del video ya incluye el agrandado, así que la cuenta no cambia.
              const rv = v.getBoundingClientRect();
              const rm = m.getBoundingClientRect();
              const r = recorteDelMarco(
                { ancho: v.videoWidth, alto: v.videoHeight },
                { ancho: rv.width, alto: rv.height },
                { x: rm.left - rv.left, y: rm.top - rv.top, ancho: rm.width, alto: rm.height },
              );
              if (r.ancho >= 1 && r.alto >= 1) {
                const reduccion = Math.min(1, ANCHO_MAXIMO / r.ancho);
                lienzo.width = Math.round(r.ancho * reduccion);
                lienzo.height = Math.max(1, Math.round(r.alto * reduccion));
                dibujo.drawImage(v, r.x, r.y, r.ancho, r.alto, 0, 0, lienzo.width, lienzo.height);
                const codigo = await detectar(lienzo);
                if (codigo && vigente) avisar(codigo);
              }
            }
          } catch {
            // Un cuadro que no se pudo leer no corta el escaneo: se prueba con el siguiente.
          }
          if (vigente) siguiente = setTimeout(ciclo, PAUSA);
        };
        void ciclo();
      } catch (e) {
        if (!vigente) return;
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
      clearTimeout(siguiente);
      pista.current = null;
      detener(flujo);
    };
  }, [paso, despues]);

  const abrir = () => {
    audio.current ??= crearAudio();
    setPaso('camara');
  };

  const cambiarLinterna = async () => {
    const camara = pista.current;
    if (!camara) return;
    const nueva = !linterna;
    if (await ajustar(camara, { torch: nueva })) setLinterna(nueva);
    else setFunciones((f) => ({ ...f, linterna: false }));
  };

  const enfocar = async (e: MouseEvent<HTMLButtonElement>) => {
    const camara = pista.current;
    const v = video.current;
    if (!camara || !v || v.videoWidth === 0) return;
    const visor = e.currentTarget.getBoundingClientRect();
    // Con teclado (detail 0) no hay punto tocado: se enfoca en el centro, donde está el marco.
    const x = e.detail === 0 ? visor.left + visor.width / 2 : e.clientX;
    const y = e.detail === 0 ? visor.top + visor.height / 2 : e.clientY;
    setFoco({
      x: ((x - visor.left) / visor.width) * 100,
      y: ((y - visor.top) / visor.height) * 100,
    });
    despues(700, () => setFoco(null));
    // El video puede estar agrandado: el punto se mide contra el video, no contra el visor.
    const rect = v.getBoundingClientRect();
    const cap = capacidades(camara);
    const ajuste: Ajuste = {};
    if (enfocaEnPunto(camara)) {
      ajuste.pointsOfInterest = [
        puntoEnVideo(
          { ancho: v.videoWidth, alto: v.videoHeight },
          { ancho: rect.width, alto: rect.height },
          { x: x - rect.left, y: y - rect.top },
        ),
      ];
    }
    const unaVez = !!cap.focusMode?.includes('single-shot');
    if (unaVez) ajuste.focusMode = 'single-shot';
    await ajustar(camara, ajuste);
    if (unaVez && cap.focusMode?.includes('continuous')) {
      despues(2500, () => {
        if (pista.current === camara) void ajustar(camara, { focusMode: 'continuous' });
      });
    }
  };

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
            <button type="button" className="m-boton m-boton--principal" onClick={abrir}>
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
          <div className="escaner__visor">
            <video
              ref={video}
              className={`escaner__video${agrandar ? ' escaner__video--agrandado' : ''}`}
              muted
              playsInline
              aria-label="Vista de la cámara"
            />
            <div
              ref={marco}
              className={`escaner__marco${destello ? ' escaner__marco--leido' : ''}`}
              aria-hidden="true"
            />
            <div className="escaner__pista" aria-hidden="true">
              Mantené unos 15 cm de distancia
            </div>
            {foco && (
              <span
                className="escaner__foco"
                style={{ left: `${foco.x}%`, top: `${foco.y}%` }}
                aria-hidden="true"
              />
            )}
            {funciones.enfocar && (
              <button
                type="button"
                className="escaner__toque"
                aria-label="Enfocar"
                onClick={enfocar}
              />
            )}
          </div>
          <p className="texto-suave">
            Poné el código dentro del marco, sobre la línea roja, a unos 15 cm. Si se ve borroso,
            alejá un poco la cámara{funciones.enfocar ? ' o tocá la imagen para enfocar' : ''}.
          </p>
          <p className="escaner__leido" role="status">
            {leido ? `Último código leído: ${leido}` : 'Cada producto leído se suma al ticket.'}
          </p>
          <div className="acciones">
            <button type="button" className="m-boton m-boton--principal" onClick={alCerrar}>
              Listo
            </button>
            {funciones.linterna && (
              <button type="button" className="m-boton" onClick={cambiarLinterna}>
                {linterna ? 'Apagar la linterna' : 'Prender la linterna'}
              </button>
            )}
          </div>
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
