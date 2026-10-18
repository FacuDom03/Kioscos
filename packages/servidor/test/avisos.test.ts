// Avisos automáticos: direcciones permitidas, firma y envío real por HTTPS a un servidor local.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enviarAviso, esIpPublica, firmarAviso, problemaDeUrl } from '../src/index.ts';

describe('direcciones', () => {
  it('distingue IPs de internet de las internas', () => {
    for (const ip of ['8.8.8.8', '2.25.133.5', '2606:4700::1111'])
      expect(esIpPublica(ip), ip).toBe(true);
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '172.17.0.2',
      '192.168.0.10',
      '169.254.169.254',
      '100.100.1.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      'no-es-ip',
    ])
      expect(esIpPublica(ip), ip).toBe(false);
  });

  it('acepta https a un sitio público y explica por qué rechaza el resto', () => {
    expect(problemaDeUrl('https://n8n.mimostrador.tech/webhook/abc')).toBeNull();
    expect(problemaDeUrl('https://hooks.zapier.com/hooks/catch/1/2/')).toBeNull();
    expect(problemaDeUrl('http://n8n.ejemplo.com/x')).toContain('https://');
    expect(problemaDeUrl('https://192.168.1.10/x')).toContain('red interna');
    expect(problemaDeUrl('https://[::1]/x')).toContain('red interna');
    expect(problemaDeUrl('https://localhost:5678/x')).toContain('red interna');
    expect(problemaDeUrl('https://postgres/x')).toContain('red interna');
    expect(problemaDeUrl('https://a:b@n8n.ejemplo.com/x')).toContain('usuario');
    expect(problemaDeUrl('no es una url')).toContain('válida');
    expect(problemaDeUrl(`https://n8n.ejemplo.com/${'x'.repeat(500)}`)).toContain('larga');
  });

  it('la firma se puede verificar con el secreto', () => {
    const cuerpo = '{"evento":"venta.creada"}';
    const firma = firmarAviso('whsec_prueba', 1_760_000_000, cuerpo);
    const esperada = createHmac('sha256', 'whsec_prueba')
      .update(`1760000000.${cuerpo}`)
      .digest('hex');
    expect(firma).toBe(`t=1760000000,v1=${esperada}`);
  });
});

describe('envío', () => {
  let servidor: Server;
  let puerto: number;
  let ca: string;
  const recibidos: { cabeceras: Record<string, unknown>; cuerpo: string }[] = [];
  let responder = 200;

  beforeAll(async () => {
    // Certificado de un solo uso para el servidor local de la prueba.
    const dir = mkdtempSync(join(tmpdir(), 'avisos-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'clave.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=avisos.prueba',
        '-addext',
        'subjectAltName=DNS:avisos.prueba',
      ],
      { stdio: 'ignore' },
    );
    ca = readFileSync(join(dir, 'cert.pem'), 'utf8');
    servidor = createServer({ key: readFileSync(join(dir, 'clave.pem')), cert: ca }, (req, res) => {
      let cuerpo = '';
      req.on('data', (p: Buffer) => (cuerpo += p.toString()));
      req.on('end', () => {
        recibidos.push({ cabeceras: req.headers, cuerpo });
        if (req.url === '/lento') return; // nunca responde
        if (req.url === '/redirige') {
          res.writeHead(302, { location: 'https://avisos.prueba/otro' });
          return res.end();
        }
        res.writeHead(responder);
        res.end('ok');
      });
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    puerto = (servidor.address() as AddressInfo).port;
  });
  afterAll(() => {
    servidor.closeAllConnections();
    servidor.close();
  });

  const local = { address: '127.0.0.1', family: 4 };
  const resolverLocal = (
    _h: string,
    _o: unknown,
    listo: (e: null, d: { address: string; family: number }[]) => void,
  ) => listo(null, [local]);

  it('manda el cuerpo y las cabeceras, y cuenta como bien solo un 2xx', async () => {
    const url = new URL(`https://avisos.prueba:${puerto}/webhook`);
    const ok = await enviarAviso(
      url,
      '{"a":1}',
      { 'x-mostrador-evento': 'venta.creada' },
      {
        resolver: resolverLocal,
        permitirPrivadas: true,
        ca,
      },
    );
    expect(ok).toEqual({ ok: true, estado: 'Respondió 200' });
    expect(recibidos.at(-1)).toMatchObject({
      cuerpo: '{"a":1}',
      cabeceras: { 'x-mostrador-evento': 'venta.creada', 'content-type': 'application/json' },
    });
    responder = 500;
    expect(
      await enviarAviso(url, '{}', {}, { resolver: resolverLocal, permitirPrivadas: true, ca }),
    ).toEqual({ ok: false, estado: 'Respondió 500' });
    responder = 200;
  });

  it('no sigue redirecciones y corta si no responde', async () => {
    const opciones = { resolver: resolverLocal, permitirPrivadas: true, ca };
    const r = await enviarAviso(
      new URL(`https://avisos.prueba:${puerto}/redirige`),
      '{}',
      {},
      opciones,
    );
    expect(r).toEqual({ ok: false, estado: 'Respondió 302' });
    const lento = await enviarAviso(
      new URL(`https://avisos.prueba:${puerto}/lento`),
      '{}',
      {},
      {
        ...opciones,
        esperaMs: 300,
      },
    );
    expect(lento).toEqual({ ok: false, estado: 'No respondió a tiempo.' });
  });

  it('no se conecta si el nombre resuelve a una IP interna, aunque el servidor exista', async () => {
    const antes = recibidos.length;
    const r = await enviarAviso(
      new URL(`https://avisos.prueba:${puerto}/webhook`),
      '{}',
      {},
      {
        resolver: resolverLocal,
        ca,
      },
    );
    expect(r).toEqual({ ok: false, estado: 'La dirección apunta a una red interna.' });
    // Basta con que una de las IPs sea interna.
    const mixta = await enviarAviso(
      new URL(`https://avisos.prueba:${puerto}/webhook`),
      '{}',
      {},
      {
        resolver: (_h, _o, listo) =>
          listo(null, [
            { address: '8.8.8.8', family: 4 },
            { address: '10.0.0.1', family: 4 },
          ]),
        ca,
      },
    );
    expect(mixta.ok).toBe(false);
    expect(recibidos.length).toBe(antes);
    expect(await enviarAviso(new URL('https://127.0.0.1/x'), '{}', {})).toEqual({
      ok: false,
      estado: 'La dirección apunta a una red interna.',
    });
  });
});
