// Avisos automáticos (webhooks) a las herramientas del comercio: n8n, Make, Zapier… Ver
// docs/API.md. Cada aviso va firmado con el secreto de ese webhook y nunca a una dirección de la
// red interna del servidor (la base, Redis, el panel): se revisa la IP a la que de verdad se
// conecta, no solo el nombre.
import { createHmac } from 'node:crypto';
import { lookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

export const EVENTOS_AVISO = [
  'venta.creada',
  'venta.anulada',
  'compra.creada',
  'stock.bajo',
] as const;
export type EventoAviso = (typeof EVENTOS_AVISO)[number];

const PRIVADAS = new BlockList();
for (const [red, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVADAS.addSubnet(red, bits, 'ipv4');
for (const [red, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVADAS.addSubnet(red, bits, 'ipv6');

/** ¿Es una IP de internet (no de una red interna, reservada o de documentación)? */
export function esIpPublica(ip: string): boolean {
  const tipo = isIP(ip);
  if (tipo === 4) return !PRIVADAS.check(ip, 'ipv4');
  if (tipo !== 6) return false;
  // IPv4 escrita como IPv6 (::ffff:10.0.0.1): se revisa la IPv4 de adentro.
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapeada) return esIpPublica(mapeada);
  if (/^::ffff:/i.test(ip)) return false;
  return !PRIVADAS.check(ip, 'ipv6');
}

/** Valida la dirección de un webhook. Devuelve el motivo si no sirve. */
export function problemaDeUrl(texto: string): string | null {
  if (texto.length > 500) return 'La dirección es demasiado larga.';
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return 'No es una dirección web válida.';
  }
  if (url.protocol !== 'https:') return 'La dirección tiene que empezar con https://.';
  if (url.username || url.password) return 'La dirección no puede llevar usuario ni contraseña.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return esIpPublica(host) ? null : 'La dirección apunta a una red interna.';
  if (
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)
  )
    return 'La dirección apunta a una red interna.';
  return null;
}

/**
 * Firma del aviso: `t=<segundos>,v1=<HMAC-SHA256 en hex de "t.cuerpo">`. Quien lo recibe la
 * recalcula con su secreto y descarta avisos viejos (más de 5 minutos).
 */
export function firmarAviso(secreto: string, segundos: number, cuerpo: string): string {
  const firma = createHmac('sha256', secreto).update(`${segundos}.${cuerpo}`).digest('hex');
  return `t=${segundos},v1=${firma}`;
}

type Resolver = (
  host: string,
  opciones: LookupAllOptions,
  listo: (err: NodeJS.ErrnoException | null, direcciones: LookupAddress[]) => void,
) => void;

export interface OpcionesEnvio {
  /** Resolución de nombres (en pruebas, una falsa). */
  resolver?: Resolver;
  /** Solo para pruebas con un servidor local. */
  permitirPrivadas?: boolean;
  /** Certificado en el que confiar además de los públicos (solo pruebas). */
  ca?: string;
  esperaMs?: number;
}

export interface ResultadoEnvio {
  ok: boolean;
  /** En palabras, para mostrarle al dueño. */
  estado: string;
}

/**
 * Manda un aviso por HTTPS. No sigue redirecciones, corta a los pocos segundos y se conecta solo
 * a IPs públicas: el nombre se resuelve acá y se usa exactamente la IP revisada.
 */
export function enviarAviso(
  url: URL,
  cuerpo: string,
  cabeceras: Record<string, string>,
  opciones: OpcionesEnvio = {},
): Promise<ResultadoEnvio> {
  const resolver: Resolver = opciones.resolver ?? ((h, o, cb) => lookup(h, o, cb));
  const permitida = (ip: string) => opciones.permitirPrivadas === true || esIpPublica(ip);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !permitida(host))
    return Promise.resolve({ ok: false, estado: 'La dirección apunta a una red interna.' });

  return new Promise((resolve) => {
    let terminado = false;
    const fin = (r: ResultadoEnvio) => {
      if (terminado) return;
      terminado = true;
      resolve(r);
    };
    const pedido = request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(cuerpo),
          'user-agent': 'Mostrador-Avisos/1',
          ...cabeceras,
        },
        timeout: opciones.esperaMs ?? 8000,
        ...(opciones.ca ? { ca: opciones.ca } : {}),
        lookup: (nombre, opts, listo) => {
          resolver(nombre, { all: true }, (err, direcciones) => {
            if (err) return listo(err, '', 4);
            if (!direcciones.length || !direcciones.every((d) => permitida(d.address))) {
              const e: NodeJS.ErrnoException = new Error('direccion_privada');
              e.code = 'DIRECCION_PRIVADA';
              return listo(e, '', 4);
            }
            const elegidas = direcciones.filter((d) => !opts.family || d.family === opts.family);
            const primera = elegidas[0];
            if (!primera) return listo(new Error('sin_direccion'), '', 4);
            if (opts.all) return listo(null, elegidas);
            return listo(null, primera.address, primera.family);
          });
        },
      },
      (res) => {
        // La respuesta no se usa: se lee un poco y se descarta.
        let leidos = 0;
        res.on('data', (parte: Buffer) => {
          leidos += parte.length;
          if (leidos > 64 * 1024) res.destroy();
        });
        res.on('end', () => {});
        res.on('error', () => {});
        const codigo = res.statusCode ?? 0;
        fin({ ok: codigo >= 200 && codigo < 300, estado: `Respondió ${codigo}` });
        res.resume();
      },
    );
    pedido.on('timeout', () => {
      pedido.destroy();
      fin({ ok: false, estado: 'No respondió a tiempo.' });
    });
    pedido.on('error', (err: NodeJS.ErrnoException) => {
      fin({
        ok: false,
        estado:
          err.code === 'DIRECCION_PRIVADA'
            ? 'La dirección apunta a una red interna.'
            : err.code === 'ENOTFOUND'
              ? 'No existe esa dirección.'
              : 'No se pudo conectar.',
      });
    });
    pedido.end(cuerpo);
  });
}
