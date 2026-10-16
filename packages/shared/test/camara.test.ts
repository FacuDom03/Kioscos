import { describe, expect, it } from 'vitest';
import { puntoEnVideo, recorteDelMarco } from '../src/camara.ts';

describe('recorteDelMarco', () => {
  it('sin recorte de pantalla, escala el marco al tamaño del video', () => {
    const r = recorteDelMarco(
      { ancho: 1280, alto: 960 },
      { ancho: 320, alto: 240 },
      { x: 32, y: 60, ancho: 256, alto: 120 },
      0,
    );
    expect(r).toEqual({ x: 128, y: 240, ancho: 1024, alto: 480 });
  });

  it('con el celular parado, compensa la parte del video que queda afuera', () => {
    // Video 1080×1920 en un visor de 360×270: se escala a 1/3 y sobran 185 px arriba y abajo.
    const r = recorteDelMarco(
      { ancho: 1080, alto: 1920 },
      { ancho: 360, alto: 270 },
      { x: 36, y: 75, ancho: 288, alto: 120 },
      0,
    );
    expect(r.x).toBeCloseTo(108);
    expect(r.ancho).toBeCloseTo(864);
    expect(r.y).toBeCloseTo((75 + 185) * 3);
    expect(r.alto).toBeCloseTo(360);
  });

  it('agrega margen y nunca se sale del video', () => {
    const r = recorteDelMarco(
      { ancho: 640, alto: 480 },
      { ancho: 640, alto: 480 },
      { x: 10, y: 100, ancho: 620, alto: 200 },
      0.1,
    );
    expect(r).toEqual({ x: 0, y: 80, ancho: 640, alto: 240 });
  });
});

describe('puntoEnVideo', () => {
  it('el centro de la pantalla es el centro del video', () => {
    expect(
      puntoEnVideo({ ancho: 1080, alto: 1920 }, { ancho: 360, alto: 270 }, { x: 180, y: 135 }),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('compensa el recorte y queda entre 0 y 1', () => {
    const p = puntoEnVideo({ ancho: 1080, alto: 1920 }, { ancho: 360, alto: 270 }, { x: 0, y: 0 });
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(185 / 640);
    expect(
      puntoEnVideo({ ancho: 100, alto: 100 }, { ancho: 100, alto: 100 }, { x: 150, y: -5 }),
    ).toEqual({ x: 1, y: 0 });
  });
});
