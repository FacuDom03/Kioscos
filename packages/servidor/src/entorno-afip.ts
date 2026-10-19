// Configuración de la facturación desde el entorno del servidor (docs/FACTURACION.md). La usan la
// API, el worker y la prueba de conexión, para que los tres facturen igual.
//
// - AFIPSDK_TOKEN: el token de la cuenta de Afip SDK. Sin él, no hay facturación.
// - AFIPSDK_PRODUCCION=1: producción (facturas que valen). Si no, el ambiente de pruebas de ARCA.
// - Certificado de Mostrador en AFIPSDK_DIR (por defecto /run/afip): cert.pem y clave.pem. En
//   pruebas, con certificado se factura con el CUIT de cada comercio; sin él, con el de pruebas.
//   En producción es obligatorio.
// - MOSTRADOR_CUIT: el CUIT que los comercios autorizan en ARCA.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClienteAfipSdk } from './afipsdk.ts';
import type { Facturador } from './facturas.ts';

const leer = (ruta: string) => {
  try {
    const texto = readFileSync(ruta, 'utf8').trim();
    return texto || undefined;
  } catch {
    return undefined;
  }
};

export interface FacturacionDelServidor {
  facturador: Facturador;
  cuitMostrador: string;
  /** En palabras, para el log al arrancar. */
  descripcion: string;
}

export function facturacionDesdeEntorno(
  env: NodeJS.ProcessEnv = process.env,
): FacturacionDelServidor | null {
  const token = env['AFIPSDK_TOKEN']?.trim();
  if (!token) return null;
  const produccion = env['AFIPSDK_PRODUCCION'] === '1';
  const dir = env['AFIPSDK_DIR'] ?? '/run/afip';
  const cert = leer(join(dir, 'cert.pem'));
  const key = leer(join(dir, 'clave.pem'));
  const conCertificado = !!cert && !!key;
  if (produccion && !conCertificado) {
    console.error('AFIPSDK_PRODUCCION=1 sin certificado: la facturación queda apagada.');
    return null;
  }
  return {
    facturador: {
      cliente: new ClienteAfipSdk({
        accessToken: token,
        produccion,
        ...(conCertificado ? { cert, key } : {}),
      }),
      prueba: !produccion,
      cuitPropio: conCertificado,
    },
    cuitMostrador: env['MOSTRADOR_CUIT']?.trim() ?? '',
    descripcion: produccion
      ? 'en producción'
      : conCertificado
        ? 'en el ambiente de pruebas de ARCA, con el CUIT de cada comercio'
        : 'en modo de prueba, con el CUIT de pruebas de Afip SDK',
  };
}
