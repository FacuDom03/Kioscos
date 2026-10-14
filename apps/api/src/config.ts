// Configuración de la API, leída una sola vez de variables de entorno.
import { leerClaves } from '@mostrador/servidor';

export interface Config {
  /** Origen exacto de la app (por ejemplo, https://app.mostrador.com.ar). CORS y CSRF. */
  origen: string;
  /** Dominio para passkeys (WebAuthn rpID): el hostname del origen. */
  rpId: string;
  rpNombre: string;
  /** Cookies con Secure y prefijo __Host- (siempre en producción). */
  cookiesSeguras: boolean;
  /** Claves maestras de cifrado por versión (base64, 32 bytes). Viven fuera de la base. */
  claves: Record<number, string>;
  claveActual: number;
}

export function configDesdeEntorno(): Config {
  const origen = process.env['APP_ORIGEN'];
  if (!origen) throw new Error('Falta APP_ORIGEN');
  const { claves, actual } = leerClaves();
  return {
    origen,
    rpId: new URL(origen).hostname,
    rpNombre: process.env['APP_NOMBRE'] ?? 'Mostrador',
    cookiesSeguras: process.env['COOKIES_INSEGURAS'] !== '1',
    claves,
    claveActual: actual,
  };
}
