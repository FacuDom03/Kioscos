// Facturación electrónica ARCA (docs/FACTURACION.md): alta del comercio, estado y reintentos.
// Es una función que el comercio prende ("facturacion" en módulos). Solo el dueño la configura.
import type { FastifyInstance } from 'fastify';
import {
  CATEGORIAS_MONOTRIBUTO,
  TERMINOS_FACTURACION,
  cuitValido,
  uuidv7,
  type CategoriaMonotributo,
} from '@mostrador/shared';
import { avisoMonotributo } from '../servicios/facturacion.ts';
import {
  CUIT_PRUEBAS_AFIPSDK,
  ErrorAfip,
  usaCuitDePrueba,
  verificarFacturacion,
} from '@mostrador/servidor';
import { z } from 'zod';
import { datosInvalidos, ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

const DUENO = ['dueno'] as const;
const VEN = ['dueno', 'encargado', 'soporte'] as const;

const noDisponible = () =>
  new ErrorPublico(
    409,
    'facturacion_no_disponible',
    'La facturación todavía no está habilitada en Mostrador. Avisanos por WhatsApp.',
  );

export async function rutasFacturacion(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/facturacion', { config: { roles: VEN } }, async (req) => {
    const f = app.facturacion;
    return req.db(async (tx) => {
      const k = await tx.selectFrom('kioscos').select('modulos').executeTakeFirstOrThrow();
      const c = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
      const conteo = await tx
        .selectFrom('comprobantes')
        .select(['estado'])
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('estado', 'in', ['pendiente', 'rechazado'])
        .groupBy('estado')
        .execute();
      const n = (e: string) => Number(conteo.find((x) => x.estado === e)?.n ?? 0);
      return {
        disponible: !!f,
        prueba: f?.facturador.prueba ?? true,
        cuitPropio: !!f?.facturador.cuitPropio,
        cuitMostrador: f?.cuitMostrador ?? '',
        activo: k.modulos.includes('facturacion'),
        config: c
          ? {
              cuit: c.cuit,
              razonSocial: c.razon_social,
              condicion: c.condicion,
              puntoVenta: c.punto_venta,
              domicilio: c.domicilio,
              iibb: c.iibb,
              inicioActividades: c.inicio_actividades,
              estado: c.estado,
              error: c.ultimo_error,
              verificadaEn: c.verificada_en,
              topeDiario: c.tope_diario,
              categoria: c.categoria_monotributo,
            }
          : null,
        monotributo:
          c?.condicion === 'monotributo'
            ? await avisoMonotributo(
                tx,
                (c.categoria_monotributo as CategoriaMonotributo | null) ?? null,
                f?.facturador.prueba ?? true,
              )
            : null,
        terminos: {
          vigente: TERMINOS_FACTURACION.version,
          aceptada: c?.terminos_version ?? null,
          aceptadosEn: c?.terminos_aceptados_en ?? null,
        },
        pendientes: n('pendiente'),
        rechazados: n('rechazado'),
      };
    });
  });

  // Prender o apagar la función (lo mismo que en Tu negocio → Funciones).
  app.put('/api/v1/facturacion/modulo', { config: { roles: DUENO } }, async (req) => {
    const { activo } = validar(z.strictObject({ activo: z.boolean() }), req.body);
    await req.db(async (tx) => {
      const k = await tx.selectFrom('kioscos').select('modulos').executeTakeFirstOrThrow();
      const modulos = activo
        ? [...new Set([...k.modulos, 'facturacion'])]
        : k.modulos.filter((m) => m !== 'facturacion');
      await tx
        .updateTable('kioscos')
        .set({ modulos, updated_at: new Date() })
        .where('id', '=', req.completa.kioscoId)
        .execute();
      await auditar(
        tx,
        req.completa,
        activo ? 'facturacion.prendida' : 'facturacion.apagada',
        {},
        req.ip,
      );
    });
    return { ok: true };
  });

  // Datos fiscales. Al guardarlos se prueba en el momento si ARCA ya tiene la autorización.
  app.post('/api/v1/facturacion/config', { config: { roles: DUENO } }, async (req) => {
    const f = app.facturacion;
    if (!f) throw noDisponible();
    const d = validar(
      z.strictObject({
        cuit: z
          .string()
          .trim()
          .regex(/^\d{11}$/),
        razonSocial: z.string().trim().min(1).max(120),
        condicion: z.enum(['monotributo', 'exento', 'responsable_inscripto']),
        puntoVenta: z.number().int().min(1).max(99998),
        domicilio: z.string().trim().min(1).max(200),
        iibb: z.string().trim().min(1).max(30).optional(),
        inicioActividades: z.iso.date().optional(),
        aceptaTerminos: z.literal(true).optional(),
        categoria: z.enum(CATEGORIAS_MONOTRIBUTO).nullable().optional(),
      }),
      req.body,
    );
    if (!cuitValido(d.cuit)) throw datosInvalidos('El CUIT no es válido: revisá los números.');
    if (d.condicion === 'responsable_inscripto')
      throw new ErrorPublico(
        409,
        'responsable_inscripto',
        'Por ahora Mostrador factura para monotributistas y exentos. Responsables inscriptos, muy pronto.',
      );
    const s = req.completa;
    await req.db(async (tx) => {
      const k = await tx.selectFrom('kioscos').select('modulos').executeTakeFirstOrThrow();
      if (!k.modulos.includes('facturacion'))
        throw new ErrorPublico(409, 'modulo_apagado', 'Primero prendé la facturación.');
      const previa = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
      if (previa?.estado === 'suspendida')
        throw new ErrorPublico(
          403,
          'suspendida',
          'La facturación de este comercio está suspendida. Escribinos para revisarla.',
        );
      const conTerminos = previa?.terminos_version === TERMINOS_FACTURACION.version;
      if (!conTerminos && !d.aceptaTerminos)
        throw new ErrorPublico(
          409,
          'terminos',
          'Para facturar tenés que leer y aceptar los términos de la facturación.',
        );
      const terminos =
        !conTerminos && d.aceptaTerminos
          ? {
              terminos_version: TERMINOS_FACTURACION.version,
              terminos_aceptados_en: new Date(),
              terminos_aceptados_por: s.usuarioId,
            }
          : {};
      const valores = {
        ...terminos,
        cuit: d.cuit,
        razon_social: d.razonSocial,
        condicion: d.condicion,
        punto_venta: d.puntoVenta,
        domicilio: d.domicilio,
        iibb: d.iibb ?? null,
        inicio_actividades: d.inicioActividades ?? null,
        categoria_monotributo: d.condicion === 'monotributo' ? (d.categoria ?? null) : null,
      };
      // Con otro CUIT o punto de venta, hay que volver a probar la autorización.
      const cambioClave = !previa || previa.cuit !== d.cuit || previa.punto_venta !== d.puntoVenta;
      if (previa)
        await tx
          .updateTable('config_fiscal')
          .set({
            ...valores,
            ...(cambioClave || previa.estado === 'baja'
              ? { estado: 'pendiente' as const, ultimo_error: null }
              : {}),
            updated_at: new Date(),
          })
          .where('id', '=', previa.id)
          .execute();
      else
        await tx
          .insertInto('config_fiscal')
          .values({ id: uuidv7(), kiosco_id: s.kioscoId, ...valores })
          .execute();
      await auditar(
        tx,
        s,
        'facturacion.datos',
        { condicion: d.condicion, puntoVenta: d.puntoVenta },
        req.ip,
      );
      if (terminos.terminos_version)
        await auditar(
          tx,
          s,
          'facturacion.terminos',
          { version: TERMINOS_FACTURACION.version },
          req.ip,
        );
    });
    return verificarFacturacion(app.base, s.kioscoId, f.facturador);
  });

  // "Buscar en ARCA": nombre, condición frente al IVA y domicilio de un CUIT, para cargar un
  // cliente sin tipear (y sin errores). Se consulta en nombre de Mostrador.
  app.post(
    '/api/v1/facturacion/padron',
    {
      config: {
        roles: ['dueno', 'encargado', 'cajero'],
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (req) => {
      const { cuit } = validar(
        z.strictObject({
          cuit: z
            .string()
            .trim()
            .transform((t) => t.replace(/\D/g, ''))
            .pipe(z.string().regex(/^\d{11}$/)),
        }),
        req.body,
      );
      if (!cuitValido(cuit)) throw datosInvalidos('El CUIT no es válido: revisá los números.');
      const f = app.facturacion;
      if (!f) throw noDisponible();
      const activo = await req.db(async (tx) => {
        const k = await tx.selectFrom('kioscos').select('modulos').executeTakeFirstOrThrow();
        return k.modulos.includes('facturacion');
      });
      if (!activo) throw new ErrorPublico(409, 'modulo_apagado', 'Primero prendé la facturación.');
      const representada = usaCuitDePrueba(f.facturador) ? CUIT_PRUEBAS_AFIPSDK : f.cuitMostrador;
      if (!representada) throw noDisponible();
      try {
        const persona = await f.facturador.cliente.padron(representada, cuit);
        if (!persona)
          throw new ErrorPublico(
            404,
            'cuit_inexistente',
            'ARCA no tiene ese CUIT. Revisá los números.',
          );
        return persona;
      } catch (error) {
        if (error instanceof ErrorPublico) throw error;
        req.log.warn({ err: error instanceof ErrorAfip ? error.message : 'error' }, 'padrón');
        throw new ErrorPublico(
          503,
          'arca_no_responde',
          'ARCA no respondió. Cargá los datos a mano o probá en un rato.',
        );
      }
    },
  );

  // Aceptar los términos vigentes (si cambiaron después del alta).
  app.post('/api/v1/facturacion/terminos', { config: { roles: DUENO } }, async (req) => {
    const { version } = validar(z.strictObject({ version: z.string().max(20) }), req.body);
    if (version !== TERMINOS_FACTURACION.version)
      throw new ErrorPublico(
        409,
        'terminos_viejos',
        'Los términos cambiaron: recargá la pantalla.',
      );
    const s = req.completa;
    await req.db(async (tx) => {
      const c = await tx.selectFrom('config_fiscal').select('id').executeTakeFirst();
      if (!c) throw noEncontrado();
      await tx
        .updateTable('config_fiscal')
        .set({
          terminos_version: version,
          terminos_aceptados_en: new Date(),
          terminos_aceptados_por: s.usuarioId,
        })
        .where('id', '=', c.id)
        .execute();
      await auditar(tx, s, 'facturacion.terminos', { version }, req.ip);
    });
    return { ok: true };
  });

  app.post(
    '/api/v1/facturacion/verificar',
    { config: { roles: DUENO, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      validar(z.strictObject({}), req.body ?? {});
      const f = app.facturacion;
      if (!f) throw noDisponible();
      return verificarFacturacion(app.base, req.completa.kioscoId, f.facturador);
    },
  );

  // Pausar, reanudar o dejar de facturar.
  app.post('/api/v1/facturacion/estado', { config: { roles: DUENO } }, async (req) => {
    const { estado } = validar(
      z.strictObject({ estado: z.enum(['pausada', 'activa', 'baja']) }),
      req.body,
    );
    await req.db(async (tx) => {
      const c = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
      if (!c) throw noEncontrado();
      if (c.estado === 'suspendida')
        throw new ErrorPublico(403, 'suspendida', 'La facturación está suspendida por Mostrador.');
      // Reanudar solo si ya estaba verificada; si no, vuelve a esperar la confirmación de ARCA.
      const nuevo = estado === 'activa' && !c.activada_en ? 'pendiente' : estado;
      await tx
        .updateTable('config_fiscal')
        .set({
          estado: nuevo,
          // Al reanudar, no se facturan las ventas del tiempo en pausa.
          ...(nuevo === 'activa' ? { activada_en: new Date() } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', c.id)
        .execute();
      // Al dejar de facturar, lo que quedó sin salir ya no sale. En pausa queda esperando.
      if (nuevo === 'baja')
        await tx
          .updateTable('comprobantes')
          .set({ estado: 'cancelado', ultimo_error: 'Se dejó de facturar antes de que saliera.' })
          .where('estado', '=', 'pendiente')
          .where('anula_id', 'is', null)
          .execute();
      await auditar(tx, req.completa, `facturacion.${nuevo}`, {}, req.ip);
    });
    return { ok: true };
  });

  // Volver a intentar una factura que ARCA rechazó (por ejemplo, después de corregir los datos).
  app.post('/api/v1/comprobantes/:id/reintentar', { config: { roles: VEN } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    validar(z.strictObject({}), req.body ?? {});
    const s = req.completa;
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('comprobantes')
        .set({ estado: 'pendiente', numero: null, ultimo_error: null })
        .where('id', '=', id)
        .where('estado', '=', 'rechazado')
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await auditar(tx, s, 'comprobante.reintento', { id }, req.ip);
    });
    await app.encolarFacturas(s.kioscoId, [id]);
    return { ok: true };
  });
}
