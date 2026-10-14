import { describe, expect, it } from 'vitest';
import { firmar, manifiesto, verificarFirma } from '../src/firma.ts';
import { desafioS256, nuevoPkce } from '../src/pkce.ts';

const secreto = 'clave-secreta-de-webhooks';

function cabecera(dataId: string, requestId: string, tsMs: number) {
  const ts = String(tsMs);
  return `ts=${ts},v1=${firmar(secreto, manifiesto(dataId, requestId, ts))}`;
}

describe('firma de webhooks', () => {
  const ahora = 1_760_000_000_000;
  it('acepta una firma válida', () => {
    expect(
      verificarFirma({
        xSignature: cabecera('ORD123', 'req-1', ahora),
        xRequestId: 'req-1',
        dataId: 'ORD123',
        secreto,
        ahoraMs: ahora,
      }),
    ).toBe(true);
  });
  it('rechaza si cambia el id, el request-id o la clave', () => {
    const h = cabecera('ORD123', 'req-1', ahora);
    expect(
      verificarFirma({
        xSignature: h,
        xRequestId: 'req-1',
        dataId: 'ORD999',
        secreto,
        ahoraMs: ahora,
      }),
    ).toBe(false);
    expect(
      verificarFirma({
        xSignature: h,
        xRequestId: 'req-2',
        dataId: 'ORD123',
        secreto,
        ahoraMs: ahora,
      }),
    ).toBe(false);
    expect(
      verificarFirma({
        xSignature: h,
        xRequestId: 'req-1',
        dataId: 'ORD123',
        secreto: 'otra',
        ahoraMs: ahora,
      }),
    ).toBe(false);
  });
  it('rechaza una firma vieja', () => {
    const h = cabecera('ORD123', 'req-1', ahora - 10 * 60_000);
    expect(
      verificarFirma({
        xSignature: h,
        xRequestId: 'req-1',
        dataId: 'ORD123',
        secreto,
        ahoraMs: ahora,
      }),
    ).toBe(false);
  });
  it('rechaza cabeceras mal formadas', () => {
    for (const h of [undefined, '', 'ts=abc,v1=xyz', 'v1=00', `ts=${ahora}`]) {
      expect(
        verificarFirma({ xSignature: h, xRequestId: 'r', dataId: 'd', secreto, ahoraMs: ahora }),
      ).toBe(false);
    }
  });
  it('el manifiesto omite lo que falta', () => {
    expect(manifiesto(undefined, 'r', '1')).toBe('request-id:r;ts:1;');
    expect(manifiesto('ABC', undefined, '1')).toBe('id:abc;ts:1;');
  });
});

describe('PKCE', () => {
  it('genera verificador y desafío S256', () => {
    const { verificador, desafio } = nuevoPkce();
    expect(verificador.length).toBeGreaterThanOrEqual(43);
    expect(desafio).toBe(desafioS256(verificador));
  });
});
