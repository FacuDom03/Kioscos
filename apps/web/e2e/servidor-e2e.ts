// Servidor para las pruebas de punta a punta: base nueva, API real en el puerto 3100.
// Lo arranca Playwright (webServer). Escribe e2e/.datos.json con lo que necesitan las pruebas.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { crearBaseApp } from '../../../packages/db/src/con-kiosco.ts';
import { prepararBaseDePrueba } from '../../../packages/db/src/pruebas.ts';
import { construirApp } from '../../api/src/app.ts';
import { MpFalso } from '../../api/test/mp-falso.ts';
import { AfipFalso } from '../../api/test/afip-falso.ts';
import { ClienteAfipSdk } from '../../../packages/servidor/src/afipsdk.ts';

const ORIGEN = 'http://127.0.0.1:4173';
const base = await prepararBaseDePrueba('mostrador_e2e');
const claves = { 1: randomBytes(32).toString('base64') };
// Mercado Pago falso en el 3101 (OAuth, órdenes QR y un control para simular pagos).
const mp = await new MpFalso(3101).iniciar();

writeFileSync(
  new URL('./.datos.json', import.meta.url),
  JSON.stringify({ adminUrl: base.adminUrl, claves, origen: ORIGEN, mpUrl: mp.url }),
);

// Afip SDK + ARCA falsos: la facturación anda en modo de prueba sin salir a internet.
const afip = new AfipFalso();

const app = await construirApp({
  base: crearBaseApp(base.appUrl, 10),
  config: {
    origen: ORIGEN,
    rpId: '127.0.0.1',
    rpNombre: 'Mostrador',
    cookiesSeguras: false,
    claves,
    claveActual: 1,
  },
  limitarPedidos: false,
  mp: {
    clientId: 'app-id',
    clientSecret: 'secreto-app',
    redirectUri: `${ORIGEN}/api/v1/mp/callback`,
    webhookSecret: 'secreto-webhooks-e2e',
    apiBase: mp.url,
    authUrl: `${mp.url}/authorization`,
    pruebas: true,
  },
  facturacion: {
    facturador: {
      cliente: new ClienteAfipSdk({ accessToken: 'e2e', produccion: false, fetch: afip.fetch }),
      prueba: true,
    },
    cuitMostrador: '20409378472',
  },
});
await app.listen({ host: '127.0.0.1', port: 3100 });
console.log('API de e2e en http://127.0.0.1:3100');
