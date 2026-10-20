// Logo y texto al pie de lo que se imprime.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
} from './ayuda.ts';

let e: Entorno;
beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

// Un PNG de 1×1 y un JPG mínimo (los primeros bytes son los que valen).
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]).toString('base64');
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
).toString('base64');

async function comercio() {
  const kioscoId = await nuevoKiosco(e.admin);
  const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
  return { kioscoId, dueno };
}

describe('personalización', () => {
  it('el dueño sube el logo; viaja la versión con la sesión y la imagen se guarda en el navegador', async () => {
    const { dueno } = await comercio();
    expect((await dueno.cliente.get('/api/v1/personalizacion/logo')).statusCode).toBe(404);
    const r = await dueno.cliente.put('/api/v1/personalizacion/logo', { datos: PNG });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ logo: 1, logoEnTicket: true, marcaAgua: false, pie: null });

    const sesion = (await dueno.cliente.get('/api/v1/auth/yo')).json<{
      kiosco: { marca: { logo: number } };
    }>();
    expect(sesion.kiosco.marca.logo).toBe(1);

    const img = await dueno.cliente.get('/api/v1/personalizacion/logo?v=1');
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);

    // Un logo nuevo cambia la versión (y la dirección).
    const otra = await dueno.cliente.put('/api/v1/personalizacion/logo', { datos: JPG });
    expect(otra.json()).toMatchObject({ logo: 2 });
    expect(
      (await dueno.cliente.get('/api/v1/personalizacion/logo?v=2')).headers['content-type'],
    ).toBe('image/jpeg');

    const sin = await dueno.cliente.delete('/api/v1/personalizacion/logo');
    expect(sin.json()).toMatchObject({ logo: null });
    expect((await dueno.cliente.get('/api/v1/personalizacion/logo?v=2')).statusCode).toBe(404);
  });

  it('rechaza lo que no es PNG o JPG (un SVG puede llevar código) y lo muy pesado', async () => {
    const { dueno } = await comercio();
    const svg = await dueno.cliente.put('/api/v1/personalizacion/logo', { datos: SVG });
    expect(svg.statusCode).toBe(400);
    const pesado = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(160 * 1024)]);
    expect(
      (
        await dueno.cliente.put('/api/v1/personalizacion/logo', {
          datos: pesado.toString('base64'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await dueno.cliente.put('/api/v1/personalizacion/logo', { datos: 'no es base64!' }))
        .statusCode,
    ).toBe(400);
  });

  it('texto al pie y marca de agua; el cajero los ve pero no los cambia', async () => {
    const { dueno } = await comercio();
    const r = await dueno.cliente.put('/api/v1/personalizacion', {
      pie: '  ¡Gracias por tu compra!  ',
      logoEnTicket: false,
      marcaAgua: true,
    });
    expect(r.json()).toEqual({
      logo: null,
      logoEnTicket: false,
      marcaAgua: true,
      pie: '¡Gracias por tu compra!',
    });
    expect(
      (
        await dueno.cliente.put('/api/v1/personalizacion', {
          pie: 'x'.repeat(201),
          logoEnTicket: true,
          marcaAgua: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await dueno.cliente.put('/api/v1/personalizacion', {
          pie: null,
          logoEnTicket: true,
          marcaAgua: false,
          color: 'rojo',
        })
      ).statusCode,
    ).toBe(400);

    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    expect((await cajero.get('/api/v1/personalizacion')).json()).toMatchObject({
      pie: '¡Gracias por tu compra!',
    });
    expect(
      (
        await cajero.put('/api/v1/personalizacion', {
          pie: 'Hackeado',
          logoEnTicket: true,
          marcaAgua: false,
        })
      ).statusCode,
    ).toBe(403);
    expect((await cajero.put('/api/v1/personalizacion/logo', { datos: PNG })).statusCode).toBe(403);
  });
});
