// Prueba de conexión con Afip SDK en su modo de desarrollo (docs/FACTURACION.md, fase 0). Usa el
// CUIT de pruebas de Afip SDK, sin certificado: no toca la base ni factura a nombre de nadie.
// En el servidor:
//   docker compose -f compose.prod.yml -f compose.traefik.yml --env-file /opt/mostrador/config.env \
//     --profile herramientas run --rm herramientas node apps/worker/src/probar-afipsdk.ts
import {
  camposDelComprobante,
  diaArgentino,
  numeroVisible,
  TIPO_COMPROBANTE,
  urlQrArca,
} from '@mostrador/shared';
import { ClienteAfipSdk, CUIT_PRUEBAS_AFIPSDK, ErrorAfip } from '@mostrador/servidor';

const token = process.env['AFIPSDK_TOKEN']?.trim();
if (!token) {
  console.log('Falta el token de Afip SDK. Cargalo en /opt/mostrador/secretos/afipsdk_token.');
  process.exit(1);
}

const cliente = new ClienteAfipSdk({ accessToken: token, produccion: false });
const cuit = CUIT_PRUEBAS_AFIPSDK;
const puntoDeVenta = 1;
const tipo = 'factura_c' as const;

function explicar(error: unknown): string {
  if (!(error instanceof ErrorAfip)) return 'Error inesperado.';
  if (error.tipo === 'red') return 'Afip SDK no respondió. ¿El servidor tiene salida a internet?';
  if (error.status === 401 || error.status === 403)
    return 'Afip SDK no aceptó el token. Revisá que esté bien copiado.';
  if (error.tipo === 'servicio') return `Afip SDK respondió con error: ${error.message}`;
  return `ARCA rechazó el pedido: ${error.message}`;
}

try {
  console.log('1. Estado de ARCA (pruebas)…');
  const e = await cliente.estado();
  console.log(`   Aplicación: ${e.app} · Base: ${e.base} · Autenticación: ${e.autenticacion}`);

  console.log('2. Último comprobante autorizado…');
  const ultimo = await cliente.ultimoAutorizado(cuit, puntoDeVenta, TIPO_COMPROBANTE[tipo]);
  console.log(`   Factura C ${numeroVisible(puntoDeVenta, ultimo)}`);

  console.log('3. Factura C de prueba por $ 100 a consumidor final…');
  const numero = ultimo + 1;
  const fecha = diaArgentino();
  const cae = await cliente.solicitarCae(
    cuit,
    camposDelComprobante({
      emisor: 'monotributo',
      tipo,
      puntoDeVenta,
      numero,
      fecha,
      comprador: { condicion: 'consumidor_final' },
      lineas: [{ subtotal: 10000, alicuota: 21 }],
    }),
  );
  console.log(`   Autorizada: Factura C ${numeroVisible(puntoDeVenta, numero)}`);
  console.log(`   CAE ${cae.cae}, vence el ${cae.vencimiento}`);
  for (const o of cae.observaciones)
    console.log(`   Observación de ARCA: (${o.codigo}) ${o.mensaje}`);

  console.log('4. La consultamos en ARCA…');
  const registrada = await cliente.consultar(cuit, puntoDeVenta, TIPO_COMPROBANTE[tipo], numero);
  console.log(registrada ? '   ARCA la tiene registrada.' : '   ARCA todavía no la muestra.');

  const qr = urlQrArca({
    fecha,
    cuitEmisor: cuit,
    puntoDeVenta,
    tipo,
    numero,
    totalCentavos: 10000,
    cae: cae.cae,
  });
  console.log(`5. QR del comprobante: ${qr}`);
  console.log('\nListo: la conexión con Afip SDK funciona.');
} catch (error) {
  console.log(`\nNo funcionó. ${explicar(error)}`);
  process.exit(1);
}
