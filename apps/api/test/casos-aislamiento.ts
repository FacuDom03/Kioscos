// Matriz de la prueba de aislamiento por rutas (sección 8 de docs/SPEC.md).
//
// Cada ruta de la API tiene que figurar acá: o es pública (lista corta y revisada), o tiene un
// caso que, autenticado como el kiosco A, intenta leer, editar o borrar recursos del kiosco B.
// `rutas.test.ts` falla si falta alguna; `aislamiento-rutas.test.ts` ejecuta los casos.
//
// En los cuerpos, "$B:<tabla>" se reemplaza por un ID de esa tabla del kiosco B.

export const RUTAS_PUBLICAS: readonly string[] = [
  'GET /health',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/salir',
  'GET /api/v1/auth/invitaciones/:token',
  'POST /api/v1/auth/invitaciones/:token',
  'GET /api/v1/auth/pin/personas',
  'POST /api/v1/auth/pin',
  'POST /api/v1/auth/soporte',
  'POST /api/v1/webhooks/mercadopago',
];

export type Espera =
  /** Recurso de B por ID: tiene que dar 404. */
  | 'no_encontrado'
  /** La respuesta no puede contener ningún ID de B. */
  | 'sin_datos_de_b'
  /** Escribe solo en el kiosco de la sesión: la base de B no tiene que cambiar. */
  | 'escribe_solo_lo_propio'
  /** Solo actúa sobre la propia sesión o persona (pasos del segundo factor). */
  | 'propia';

export interface CasoAislamiento {
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Igual que en Fastify, por ejemplo `/api/v1/productos/:id`. */
  url: string;
  espera: Espera;
  /** Tabla de la que se toma un ID del kiosco B para reemplazar `:id`. */
  tabla?: string;
  cuerpo?: unknown;
}

const caso = (
  metodo: CasoAislamiento['metodo'],
  url: string,
  espera: Espera,
  extra: Partial<CasoAislamiento> = {},
): CasoAislamiento => ({ metodo, url, espera, ...extra });

export const CASOS_AISLAMIENTO: readonly CasoAislamiento[] = [
  // Cuenta y sesión
  caso('GET', '/api/v1/auth/yo', 'sin_datos_de_b'),
  caso('POST', '/api/v1/auth/kiosco', 'no_encontrado', { cuerpo: { kioscoId: '$B:kioscos' } }),
  caso('POST', '/api/v1/auth/totp', 'propia'),
  caso('POST', '/api/v1/auth/recuperacion', 'propia'),
  caso('POST', '/api/v1/auth/passkey/opciones', 'propia'),
  caso('POST', '/api/v1/auth/passkey/verificar', 'propia'),
  caso('POST', '/api/v1/auth/configurar/totp', 'propia'),
  caso('POST', '/api/v1/auth/configurar/totp/confirmar', 'propia'),
  caso('POST', '/api/v1/auth/configurar/passkey/opciones', 'propia'),
  caso('POST', '/api/v1/auth/configurar/passkey/verificar', 'propia'),
  caso('GET', '/api/v1/cuenta/seguridad', 'sin_datos_de_b'),
  caso('POST', '/api/v1/cuenta/codigos', 'propia'),
  caso('DELETE', '/api/v1/cuenta/passkeys/:id', 'no_encontrado', { tabla: 'passkeys' }),
  caso('POST', '/api/v1/cuenta/password', 'escribe_solo_lo_propio', {
    cuerpo: { actual: 'incorrecta', nueva: 'otra contraseña larga' },
  }),

  // Dispositivos
  caso('GET', '/api/v1/dispositivos', 'sin_datos_de_b'),
  caso('POST', '/api/v1/dispositivos', 'escribe_solo_lo_propio', {
    cuerpo: { nombre: 'Equipo A' },
  }),
  caso('DELETE', '/api/v1/dispositivos/:id', 'no_encontrado', { tabla: 'dispositivos' }),

  // Usuarios
  caso('GET', '/api/v1/usuarios', 'sin_datos_de_b'),
  caso('POST', '/api/v1/usuarios/cajeros', 'escribe_solo_lo_propio', {
    cuerpo: { nombre: 'Cajero A', pin: '1234' },
  }),
  caso('PUT', '/api/v1/usuarios/:id/pin', 'no_encontrado', {
    tabla: 'membresias',
    cuerpo: { pin: '9999' },
  }),
  caso('PATCH', '/api/v1/usuarios/:id', 'no_encontrado', {
    tabla: 'membresias',
    cuerpo: { activa: false },
  }),
  caso('POST', '/api/v1/usuarios/invitaciones', 'escribe_solo_lo_propio', {
    cuerpo: { email: 'nuevo@ejemplo.test' },
  }),
  caso('DELETE', '/api/v1/usuarios/invitaciones/:id', 'no_encontrado', { tabla: 'invitaciones' }),

  // Kiosco
  caso('GET', '/api/v1/kiosco', 'sin_datos_de_b'),
  caso('PUT', '/api/v1/kiosco/soporte', 'escribe_solo_lo_propio', { cuerpo: { activo: true } }),
  caso('GET', '/api/v1/auditoria', 'sin_datos_de_b'),

  // Catálogo y stock
  caso('GET', '/api/v1/catalogo', 'sin_datos_de_b'),
  caso('POST', '/api/v1/categorias', 'escribe_solo_lo_propio', { cuerpo: { nombre: 'Varios A' } }),
  caso('PATCH', '/api/v1/categorias/:id', 'no_encontrado', {
    tabla: 'categorias',
    cuerpo: { nombre: 'Robada' },
  }),
  caso('DELETE', '/api/v1/categorias/:id', 'no_encontrado', { tabla: 'categorias' }),
  caso('GET', '/api/v1/productos', 'sin_datos_de_b'),
  caso('GET', '/api/v1/productos/:id', 'no_encontrado', { tabla: 'productos' }),
  caso('POST', '/api/v1/productos', 'escribe_solo_lo_propio', {
    cuerpo: { nombre: 'Intruso', precio: 100, categoriaId: '$B:categorias' },
  }),
  caso('PATCH', '/api/v1/productos/:id', 'no_encontrado', {
    tabla: 'productos',
    cuerpo: { precio: 1 },
  }),
  caso('POST', '/api/v1/stock/ajustes', 'no_encontrado', {
    cuerpo: { productoId: '$B:productos', motivo: 'rotura', cantidad: -1 },
  }),
  caso('POST', '/api/v1/productos/importar', 'escribe_solo_lo_propio', {
    cuerpo: { csv: 'nombre;precio;codigo\nCoca de A;100;7790895000997' },
  }),
  caso('POST', '/api/v1/compras', 'no_encontrado', {
    cuerpo: { items: [{ productoId: '$B:productos', cantidad: 1, costoUnitario: 100 }] },
  }),
  caso('GET', '/api/v1/compras', 'sin_datos_de_b'),
  caso('POST', '/api/v1/precios/vista-previa', 'sin_datos_de_b', {
    cuerpo: { alcance: 'seleccion', productoIds: ['$B:productos'], porcentaje: 10, redondeo: 1000 },
  }),
  caso('POST', '/api/v1/precios/aumentos', 'escribe_solo_lo_propio', {
    cuerpo: { alcance: 'categoria', categoriaId: '$B:categorias', porcentaje: 50, redondeo: 1000 },
  }),
  caso('GET', '/api/v1/precios/aumentos', 'sin_datos_de_b'),
  caso('POST', '/api/v1/precios/aumentos/:id/deshacer', 'no_encontrado', {
    tabla: 'cambios_precio',
  }),

  // Ventas y caja
  caso('POST', '/api/v1/sync', 'escribe_solo_lo_propio', {
    cuerpo: {
      ops: [
        {
          tipo: 'venta',
          datos: {
            id: '0192a000-0000-7000-8000-00000000aaa1',
            turnoId: '$B:turnos_caja',
            creadaEn: '2026-10-14T10:00:00-03:00',
            total: 180000,
            items: [
              {
                id: '0192a000-0000-7000-8000-00000000aaa2',
                productoId: '$B:productos',
                descripcion: 'X',
                cantidad: 1,
                precioUnitario: 180000,
              },
            ],
            pagos: [
              { id: '0192a000-0000-7000-8000-00000000aaa3', medio: 'efectivo', monto: 180000 },
            ],
          },
        },
        {
          tipo: 'gasto',
          datos: {
            id: '0192a000-0000-7000-8000-00000000aaa4',
            turnoId: '$B:turnos_caja',
            tipo: 'gasto',
            monto: 1,
            motivo: 'X',
            creadoEn: '2026-10-14T10:00:00-03:00',
          },
        },
      ],
    },
  }),
  caso('GET', '/api/v1/ventas', 'sin_datos_de_b'),
  caso('GET', '/api/v1/ventas/:id', 'no_encontrado', { tabla: 'ventas' }),
  caso('POST', '/api/v1/ventas/:id/anular', 'no_encontrado', {
    tabla: 'ventas',
    cuerpo: { motivo: 'Intrusión' },
  }),
  caso('POST', '/api/v1/ventas/:id/devuelta', 'no_encontrado', { tabla: 'ventas' }),
  caso('GET', '/api/v1/caja', 'sin_datos_de_b'),
  caso('POST', '/api/v1/caja/turnos/:id/cerrar', 'no_encontrado', {
    tabla: 'turnos_caja',
    cuerpo: { contado: 0 },
  }),
  caso('GET', '/api/v1/caja/cierres', 'sin_datos_de_b'),

  // Mercado Pago
  caso('GET', '/api/v1/mp/estado', 'sin_datos_de_b'),
  caso('GET', '/api/v1/mp/conectar', 'escribe_solo_lo_propio'),
  caso('GET', '/api/v1/mp/callback', 'escribe_solo_lo_propio'),
  caso('POST', '/api/v1/mp/probar', 'escribe_solo_lo_propio'),
  caso('POST', '/api/v1/mp/desconectar', 'escribe_solo_lo_propio'),
  caso('POST', '/api/v1/cobros/qr', 'escribe_solo_lo_propio', {
    cuerpo: {
      ventaId: '0192a000-0000-7000-8000-00000000bbb1',
      pagoId: '0192a000-0000-7000-8000-00000000bbb2',
      turnoId: '$B:turnos_caja',
      creadaEn: '2026-10-14T10:00:00-03:00',
      total: 100,
      items: [
        {
          id: '0192a000-0000-7000-8000-00000000bbb3',
          productoId: '$B:productos',
          descripcion: 'X',
          cantidad: 1,
          precioUnitario: 100,
        },
      ],
    },
  }),
  caso('GET', '/api/v1/pagos/:id', 'no_encontrado', { tabla: 'pagos' }),
  caso('POST', '/api/v1/pagos/:id/cancelar', 'no_encontrado', { tabla: 'pagos' }),
  caso('GET', '/api/v1/ventas/pendientes', 'sin_datos_de_b'),
  caso('POST', '/api/v1/ventas/:id/resolver', 'no_encontrado', {
    tabla: 'ventas',
    cuerpo: { accion: 'anular' },
  }),
];
