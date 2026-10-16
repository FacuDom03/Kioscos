// Cuentas del escáner con cámara (sección 14.2). El video se muestra con `object-fit: cover`,
// así que lo que se ve en pantalla es un recorte del cuadro real de la cámara: para leer solo
// dentro del marco o enfocar donde se tocó hay que pasar de puntos de pantalla a puntos del video.

export interface Tamano {
  ancho: number;
  alto: number;
}

export interface Rectangulo extends Tamano {
  x: number;
  y: number;
}

/** Escala y desplazamiento del video dentro del elemento con `object-fit: cover`. */
function cubrir(video: Tamano, elemento: Tamano) {
  const escala = Math.max(elemento.ancho / video.ancho, elemento.alto / video.alto);
  return {
    escala,
    dx: (video.ancho * escala - elemento.ancho) / 2,
    dy: (video.alto * escala - elemento.alto) / 2,
  };
}

const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Parte del cuadro de la cámara (en píxeles del video) que cae dentro del marco dibujado en
 * pantalla. `marco` va en píxeles del elemento, medido desde su esquina. `margen` agranda el
 * recorte en esa fracción por cada lado, para no perder un código que asoma un poco del marco.
 */
export function recorteDelMarco(
  video: Tamano,
  elemento: Tamano,
  marco: Rectangulo,
  margen = 0.1,
): Rectangulo {
  const { escala, dx, dy } = cubrir(video, elemento);
  const ancho = marco.ancho / escala;
  const alto = marco.alto / escala;
  const x0 = entre((marco.x + dx) / escala - ancho * margen, 0, video.ancho);
  const y0 = entre((marco.y + dy) / escala - alto * margen, 0, video.alto);
  const x1 = entre((marco.x + dx) / escala + ancho * (1 + margen), 0, video.ancho);
  const y1 = entre((marco.y + dy) / escala + alto * (1 + margen), 0, video.alto);
  return { x: x0, y: y0, ancho: x1 - x0, alto: y1 - y0 };
}

/** Punto tocado en pantalla, como fracción (0 a 1) del cuadro de la cámara. */
export function puntoEnVideo(
  video: Tamano,
  elemento: Tamano,
  punto: { x: number; y: number },
): { x: number; y: number } {
  const { escala, dx, dy } = cubrir(video, elemento);
  return {
    x: entre((punto.x + dx) / escala / video.ancho, 0, 1),
    y: entre((punto.y + dy) / escala / video.alto, 0, 1),
  };
}
