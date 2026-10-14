// Firma de webhooks de Mercado Pago (header x-signature: "ts=...,v1=...").
// Manifiesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (se omite la parte que falte).
// HMAC-SHA256 en hexadecimal con la clave secreta de webhooks. Comparación en tiempo constante.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DatosFirma {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secreto: string;
  /** Tolerancia de antigüedad del ts (por defecto 5 minutos). */
  toleranciaSeg?: number;
  ahoraMs?: number;
}

export function manifiesto(
  dataId: string | undefined,
  requestId: string | undefined,
  ts: string,
): string {
  let m = '';
  if (dataId) m += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return m;
}

export function firmar(secreto: string, texto: string): string {
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

export function verificarFirma(d: DatosFirma): boolean {
  if (!d.xSignature) return false;
  const partes = Object.fromEntries(
    d.xSignature.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k ?? '', v.join('=')];
    }),
  );
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1 || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  // El ts puede venir en segundos o en milisegundos.
  const tsMs = ts.length > 11 ? Number(ts) : Number(ts) * 1000;
  const ahora = d.ahoraMs ?? Date.now();
  if (Math.abs(ahora - tsMs) > (d.toleranciaSeg ?? 300) * 1000) return false;
  const esperado = Buffer.from(firmar(d.secreto, manifiesto(d.dataId, d.xRequestId, ts)), 'hex');
  const recibido = Buffer.from(v1.toLowerCase(), 'hex');
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
