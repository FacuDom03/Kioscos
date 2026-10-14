import { cerrarBaseApp, crearBaseApp, type BaseApp } from '@mostrador/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { construirApp } from '../src/app.ts';
import { CASOS_AISLAMIENTO, RUTAS_PUBLICAS } from './casos-aislamiento.ts';

let base: BaseApp;
let app: FastifyInstance;

beforeAll(async () => {
  base = crearBaseApp(inject('appUrl'), 2);
  app = await construirApp({ base });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cerrarBaseApp(base);
});

describe('rutas', () => {
  it('/health responde con la base andando', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ base: 'ok' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('una ruta inexistente da 404 genérico', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: 'No encontrado' });
  });

  it('toda ruta es pública declarada o está cubierta por la prueba de aislamiento', () => {
    const cubiertas = new Set([
      ...RUTAS_PUBLICAS,
      ...CASOS_AISLAMIENTO.map((c) => `${c.metodo} ${c.url}`),
    ]);
    expect(app.rutasRegistradas.length).toBeGreaterThan(0);
    expect(app.rutasRegistradas.filter((r) => !cubiertas.has(r))).toEqual([]);
  });
});

describe('deniego por defecto', () => {
  it('una ruta sin marcar como pública responde 401 y no ejecuta el handler', async () => {
    let ejecutado = false;
    const otra = await construirApp({ base });
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
