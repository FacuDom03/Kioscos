// Términos y condiciones de la facturación electrónica (decisión 010). El comercio los acepta
// antes de activarla; se guarda la versión, cuándo y quién. Si cambian, se sube la versión y la
// app los vuelve a pedir. BORRADOR: falta la revisión de un abogado (docs/FACTURACION.md).

export const TERMINOS_FACTURACION = {
  version: '2026-10-20',
  titulo: 'Términos y condiciones de la facturación electrónica',
  secciones: [
    {
      titulo: 'Qué hace Mostrador',
      texto:
        'Con la autorización que nos das en ARCA, Mostrador pide en tu nombre la autorización (CAE) de las facturas y notas de crédito de las ventas que registrás en la app. Somos tu representante solo para el servicio "Facturación Electrónica". Nunca te pedimos ni guardamos tu clave fiscal.',
    },
    {
      titulo: 'Lo que es responsabilidad tuya',
      texto:
        'Sos el único responsable de lo que se factura con tu CUIT: que las ventas sean reales, que tus datos fiscales (CUIT, condición, punto de venta y domicilio) sean correctos y estén al día, y de cumplir tus obligaciones ante ARCA y otros organismos (categoría del monotributo, ingresos brutos y demás). Mostrador no da asesoramiento impositivo: para eso, consultá a tu contador.',
    },
    {
      titulo: 'Cómo se factura',
      texto:
        'Solo se factura una venta registrada y cobrada en Mostrador, por su importe. Una factura emitida no se modifica: para corregirla se anula la venta y sale la nota de crédito. Si ARCA no responde, la factura sale cuando vuelva; si ARCA la rechaza, te mostramos el motivo para que lo resuelvas.',
    },
    {
      titulo: 'Topes, alertas y suspensión',
      texto:
        'Para cuidar a todos los comercios hay un tope diario de facturación y revisamos los movimientos fuera de lo común (por ejemplo, muchas anulaciones). Mostrador puede pausar o suspender la facturación de un comercio ante un uso indebido o si ARCA lo pide, y te va a avisar.',
    },
    {
      titulo: 'Colaboración con ARCA',
      texto:
        'Si ARCA u otra autoridad competente lo pide, Mostrador puede informar los registros de facturación de tu comercio: qué se facturó, cuándo y desde qué usuario.',
    },
    {
      titulo: 'Disponibilidad',
      texto:
        'La facturación depende de ARCA y de proveedores externos. Mostrador no responde por caídas, demoras o cambios de ARCA, pero guarda cada venta y reintenta sola. Tus comprobantes están siempre en ARCA ("Mis Comprobantes") y los podés exportar desde Mostrador.',
    },
    {
      titulo: 'Baja',
      texto:
        'Podés dejar de facturar cuando quieras desde la app y quitar la autorización en ARCA. Las facturas emitidas no se borran.',
    },
    {
      titulo: 'Tus datos',
      texto:
        'Guardamos tus datos fiscales y los comprobantes solo para facturar y para tus registros. Si cambian estos términos, te los vamos a mostrar para que los aceptes de nuevo.',
    },
  ],
} as const;
