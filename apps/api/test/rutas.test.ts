import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app.ts';
import { CASOS_AISLAMIENTO, RUTAS_PUBLICAS } from './casos-aislamiento.ts';
import { Cliente, configPrueba, crearEntorno, type Entorno } from './ayuda.ts';

let e: Entorno;

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

const conIds = (url: string) => url.replace(/:[a-zA-Z]+/g, '0192a000-0000-7000-8000-0000000000ee');

describe('rutas', () => {
  it('/health responde con la base andando', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ base: 'ok' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('una ruta inexistente da 404 genérico', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(r.statusCode).toBe(404);
  });

  it('toda ruta es pública declarada o está cubierta por la prueba de aislamiento', () => {
    const cubiertas = new Set([
      ...RUTAS_PUBLICAS,
      ...CASOS_AISLAMIENTO.map((c) => `${c.metodo} ${c.url}`),
    ]);
    expect(e.app.rutasRegistradas.filter((r) => !cubiertas.has(r))).toEqual([]);
  });

  it('las rutas públicas declaradas existen', () => {
    for (const r of RUTAS_PUBLICAS) expect(e.app.rutasRegistradas).toContain(r);
  });

  it('sin sesión, toda ruta no pública responde 401', async () => {
    const c = new Cliente(e.app);
    const privadas = e.app.rutasRegistradas.filter((r) => !RUTAS_PUBLICAS.includes(r));
    expect(privadas.length).toBeGreaterThan(10);
    for (const r of privadas) {
      const [metodo, url] = r.split(' ') as ['GET', string];
      const res = await c.pedir(metodo, conIds(url), metodo === 'GET' ? undefined : {});
      expect(res.statusCode, r).toBe(401);
    }
  });
});

describe('deniego por defecto', () => {
  it('una ruta sin roles declarados responde 403 aun con sesión, y sin sesión 401', async () => {
    let ejecutado = false;
    const otra = await construirApp({ base: e.base, config: configPrueba });
    otra.get('/api/v1/privada', async () => {
      ejecutado = true;
      return { dato: 'secreto' };
    });
    const r = await otra.inject({ method: 'GET', url: '/api/v1/privada' });
    expect(r.statusCode).toBe(401);
    expect(r.body).not.toContain('secreto');
    expect(ejecutado).toBe(false);
    await otra.close();
  });
});
