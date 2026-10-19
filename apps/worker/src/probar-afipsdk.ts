// Prueba de conexión con Afip SDK (docs/FACTURACION.md). No toca la base.
// - Sin certificado: con el CUIT de pruebas de Afip SDK y un punto de venta al azar.
// - Con el certificado de pruebas de Mostrador (WSASS) y MOSTRADOR_CUIT: con ese CUIT, en el
//   ambiente de pruebas de ARCA (punto de venta 1, o el que se pase como argumento).
// En producción no corre, para no emitir una factura real.
// En el servidor:
//   docker compose -f compose.prod.yml -f compose.traefik.yml --env-file /opt/mostrador/config.env \
//     --profile herramientas run --rm herramientas node apps/worker/src/probar-afipsdk.ts
import {
  camposDelComprobante,
  diaArgentino,
  diaCorto,
  numeroVisible,
  sumarDias,
  TIPO_COMPROBANTE,
  urlQrArca,
} from '@mostrador/shared';
import {
  CUIT_PRUEBAS_AFIPSDK,
  ErrorAfip,
  facturacionDesdeEntorno,
  type Cae,
} from '@mostrador/servidor';

const config = facturacionDesdeEntorno();
if (!config) {
  console.log('Falta el token de Afip SDK. Cargalo en /opt/mostrador/secretos/afipsdk_token.');
  process.exit(1);
}
if (!config.facturador.prueba) {
  console.log(
    'Estás en producción (AFIPSDK_PRODUCCION=1): la prueba no corre para no emitir una factura real.',
  );
  process.exit(1);
}
const cliente = config.facturador.cliente;
const conCuitPropio = !!config.facturador.cuitPropio;
if (conCuitPropio && !config.cuitMostrador) {
  console.log('Hay certificado pero falta MOSTRADOR_CUIT en /opt/mostrador/config.env.');
  process.exit(1);
}
const cuit = conCuitPropio ? config.cuitMostrador : CUIT_PRUEBAS_AFIPSDK;
// El punto de venta 1 del CUIT de pruebas lo usa todo el mundo (y a veces queda trabado por
// facturas con fecha futura): con ese CUIT se usa uno al azar. Con el CUIT propio, el 1.
const puntoDeVenta =
  Number(process.argv[2]) || (conCuitPropio ? 1 : 2000 + Math.floor(Math.random() * 7998));
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
  console.log(
    conCuitPropio
      ? `Con tu CUIT, en el ambiente de pruebas de ARCA. Punto de venta ${puntoDeVenta}.`
      : `Con el CUIT de pruebas de Afip SDK. Punto de venta ${puntoDeVenta}.`,
  );
  console.log('1. Estado de ARCA (pruebas)…');
  const e = await cliente.estado();
  console.log(`   Aplicación: ${e.app} · Base: ${e.base} · Autenticación: ${e.autenticacion}`);

  // El CUIT de pruebas lo comparten todos los que usan Afip SDK: otro puede tomar el mismo
  // número al mismo tiempo. Si ARCA dice que no es el próximo, se vuelve a leer y se reintenta
  // (lo mismo que va a hacer la cola de facturas con los comercios).
  let numero = 0;
  let fecha = '';
  let cae: Cae | null = null;
  for (let intento = 1; !cae; intento++) {
    console.log(intento === 1 ? '2. Próximo número y fecha…' : '   Volviendo a leer el próximo…');
    const p = await cliente.proximo(cuit, puntoDeVenta, TIPO_COMPROBANTE[tipo]);
    const hoy = diaArgentino();
    numero = p.numero;
    fecha = p.fechaMinima && p.fechaMinima > hoy ? p.fechaMinima : hoy;
    if (fecha > sumarDias(hoy, 5)) {
      console.log(
        `\nEl punto de venta ${puntoDeVenta} tiene una factura con fecha ${diaCorto(fecha)}, más de 5 días adelante. Volvé a correr la prueba: va a usar otro.`,
      );
      process.exit(1);
    }
    console.log(`   Factura C ${numeroVisible(puntoDeVenta, numero)} con fecha ${diaCorto(fecha)}`);
    if (intento === 1) console.log('3. Factura C de prueba por $ 100 a consumidor final…');
    try {
      cae = await cliente.solicitarCae(
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
    } catch (error) {
      if (!(error instanceof ErrorAfip) || error.codigo !== 10016 || intento >= 5) throw error;
      console.log('   Otro usuario del CUIT de pruebas tomó ese número. Reintentando…');
      await new Promise((r) => setTimeout(r, 1000 * intento));
    }
  }
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
