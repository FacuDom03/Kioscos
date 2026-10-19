// Configuración de la facturación desde el entorno: ambiente, certificado y CUIT.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { facturacionDesdeEntorno, usaCuitDePrueba } from '../src/index.ts';

const vacia = mkdtempSync(join(tmpdir(), 'afip-'));
const conCertificado = mkdtempSync(join(tmpdir(), 'afip-'));
writeFileSync(join(conCertificado, 'cert.pem'), '-----BEGIN CERTIFICATE-----\nx\n');
writeFileSync(join(conCertificado, 'clave.pem'), '-----BEGIN PRIVATE KEY-----\nx\n');

describe('facturacionDesdeEntorno', () => {
  it('sin token no hay facturación', () => {
    expect(facturacionDesdeEntorno({ AFIPSDK_DIR: conCertificado })).toBeNull();
  });

  it('sin certificado, pruebas con el CUIT de pruebas de Afip SDK', () => {
    const f = facturacionDesdeEntorno({ AFIPSDK_TOKEN: 't', AFIPSDK_DIR: vacia });
    expect(f?.facturador).toMatchObject({ prueba: true, cuitPropio: false });
    expect(usaCuitDePrueba(f!.facturador)).toBe(true);
  });

  it('con certificado, pruebas con el CUIT de cada comercio', () => {
    const f = facturacionDesdeEntorno({
      AFIPSDK_TOKEN: 't',
      AFIPSDK_DIR: conCertificado,
      MOSTRADOR_CUIT: ' 27301234568 ',
    });
    expect(f).toMatchObject({
      facturador: { prueba: true, cuitPropio: true },
      cuitMostrador: '27301234568',
    });
    expect(usaCuitDePrueba(f!.facturador)).toBe(false);
  });

  it('en producción sin certificado queda apagada', () => {
    const env = { AFIPSDK_TOKEN: 't', AFIPSDK_PRODUCCION: '1', AFIPSDK_DIR: vacia };
    const error = console.error;
    console.error = () => undefined;
    try {
      expect(facturacionDesdeEntorno(env)).toBeNull();
    } finally {
      console.error = error;
    }
    const f = facturacionDesdeEntorno({ ...env, AFIPSDK_DIR: conCertificado });
    expect(f?.facturador).toMatchObject({ prueba: false, cuitPropio: true });
  });
});
