// Mercado Pago: conexión por OAuth con PKCE, cobro con QR (Orders API) y webhooks
// (sección 13 de docs/SPEC.md). Los tokens nunca salen de la API.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  externalPosId,
  externalStoreId,
  integracionDelKiosco,
  nuevoPkce,
  reconsultarPago,
  verificarFirma,
  type ClienteMp,
  type ConfigMp,
} from '@mostrador/mp';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';
import { subtotal, uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { moverStock } from '../servicios/stock.ts';
import { validar } from '../validar.ts';

declare module 'fastify' {
  interface FastifyInstance {
    mp: { config: ConfigMp; cliente: ClienteMp } | null;
    /** Encola la reconsulta de una orden (worker con BullMQ, o en el mismo proceso). */
    encolarOrdenMp: (ordenId: string) => Promise<void>;
  }
}

const VENDEN = ['dueno', 'encargado', 'cajero'] as const;
const centavos = z.number().int().min(0).max(100_000_000_000);

const noConfigurado = () =>
  new ErrorPublico(
    503,
    'mp_no_configurado',
    'Mercado Pago todavía no está disponible. Cobrá en efectivo o por transferencia.',
  );
const sinConexionMp = () =>
  new ErrorPublico(
    409,
    'mp_sin_conectar',
    'Para cobrar con QR, el dueño tiene que conectar Mercado Pago en Más → Conexiones.',
  );
const errorQr = () =>
  new ErrorPublico(502, 'qr', 'No se pudo crear el QR. Revisá la conexión o cobrá en efectivo.');

function mpOError(app: FastifyInstance) {
  if (!app.mp) throw noConfigurado();
  return app.mp;
}

export async function rutasMp(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------ estado y conexión
  app.get(
    '/api/v1/mp/estado',
    { config: { roles: ['dueno', 'encargado', 'cajero', 'soporte'] } },
    async (req) => {
      if (!app.mp) return { configurado: false, estado: 'desconectado', puedeCobrar: false };
      return req.db(async (tx) => {
        const i = await tx
          .selectFrom('integraciones')
          .select(['estado', 'mp_external_pos_id', 'updated_at'])
          .where('proveedor', '=', 'mercadopago')
          .executeTakeFirst();
        const estado = i?.estado ?? 'desconectado';
        return {
          configurado: true,
          estado,
          puedeCobrar: estado === 'conectado' && !!i?.mp_external_pos_id,
        };
      });
    },
  );

  app.get('/api/v1/mp/conectar', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const mp = mpOError(app);
    const state = tokenAleatorio();
    const { verificador, desafio } = nuevoPkce();
    const cif = app.cifrador.cifrar(verificador);
    await req.db((tx) =>
      tx
        .insertInto('oauth_estados')
        .values({
          id: uuidv7(),
          kiosco_id: req.completa.kioscoId,
          usuario_id: req.completa.usuarioId,
          state_hash: hashToken(state),
          verificador_cifrado: cif.datos,
          clave_version: cif.version,
          vence_en: new Date(Date.now() + 10 * 60_000),
        })
        .execute(),
    );
    return reply.redirect(mp.cliente.urlAutorizacion(state, desafio));
  });

  app.get('/api/v1/mp/callback', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const mp = mpOError(app);
    const volver = (resultado: string) => reply.redirect(`/mas/conexiones?mp=${resultado}`);
    const q = z
      .looseObject({
        code: z.string().max(500).optional(),
        state: z.string().max(200).optional(),
        error: z.string().max(200).optional(),
      })
      .safeParse(req.query);
    if (!q.success || !q.data.code || !q.data.state) return volver('cancelado');
    const { code, state } = q.data;
    const s = req.completa;

    // El state es de un solo uso, de esta sesión (kiosco y persona) y vence en 10 minutos.
    const verificador = await req.db(async (tx) => {
      const e = await tx
        .selectFrom('oauth_estados')
        .selectAll()
        .where('state_hash', '=', hashToken(state))
        .forUpdate()
        .executeTakeFirst();
      if (!e || e.usado_en || e.vence_en < new Date() || e.usuario_id !== s.usuarioId) return null;
      await tx
        .updateTable('oauth_estados')
        .set({ usado_en: new Date() })
        .where('id', '=', e.id)
        .execute();
      return app.cifrador.descifrar(e.verificador_cifrado, e.clave_version).toString('utf8');
    });
    if (!verificador) return volver('vencido');

    try {
      const tokens = await mp.cliente.intercambiarCodigo(code, verificador);
      const userId = String(tokens.user_id);
      const nombreKiosco = await req.db(
        async (tx) =>
          (await tx.selectFrom('kioscos').select('nombre').executeTakeFirstOrThrow()).nombre,
      );
      // Sucursal y caja de Mercado Pago, con IDs externos estables por kiosco (se reusan si ya existen).
      const extStore = externalStoreId(s.kioscoId);
      const extPos = externalPosId(s.kioscoId);
      const sucursal =
        (await mp.cliente.buscarSucursal(tokens.access_token, userId, extStore)) ??
        (await mp.cliente.crearSucursal(tokens.access_token, userId, {
          nombre: nombreKiosco,
          externalId: extStore,
        }));
      const caja =
        (await mp.cliente.buscarCaja(tokens.access_token, extPos)) ??
        (await mp.cliente.crearCaja(tokens.access_token, {
          nombre: 'Caja Mostrador',
          storeId: sucursal.id,
          externalId: extPos,
        }));

      const acceso = app.cifrador.cifrar(tokens.access_token);
      const refresco = app.cifrador.cifrar(tokens.refresh_token);
      const datos = {
        estado: 'conectado' as const,
        mp_user_id: userId,
        access_token_cifrado: acceso.datos,
        refresh_token_cifrado: refresco.datos,
        clave_version: acceso.version,
        vence_en: new Date(Date.now() + tokens.expires_in * 1000),
        mp_sucursal_id: sucursal.id,
        mp_caja_id: caja.id,
        mp_external_pos_id: extPos,
        updated_at: new Date(),
      };
      await req.db(async (tx) => {
        const existe = await tx
          .selectFrom('integraciones')
          .select('id')
          .where('proveedor', '=', 'mercadopago')
          .executeTakeFirst();
        if (existe)
          await tx.updateTable('integraciones').set(datos).where('id', '=', existe.id).execute();
        else
          await tx
            .insertInto('integraciones')
            .values({ id: uuidv7(), kiosco_id: s.kioscoId, proveedor: 'mercadopago', ...datos })
            .execute();
        await auditar(tx, s, 'mp.conectado', { mp_user_id: userId }, req.ip);
      });
      return volver('ok');
    } catch (error) {
      req.log.error({ err: error }, 'No se pudo conectar Mercado Pago');
      return volver('error');
    }
  });

  // "Probar conexión": token válido y caja creada, sin mover plata.
  app.post('/api/v1/mp/probar', { config: { roles: ['dueno'] } }, async (req) => {
    const mp = mpOError(app);
    validar(z.strictObject({}).optional(), req.body);
    const integ = await req.db((tx) => integracionDelKiosco(tx, app.cifrador));
    if (!integ) throw sinConexionMp();
    try {
      const yo = await mp.cliente.yo(integ.accessToken);
      const caja = integ.externalPosId
        ? await mp.cliente.buscarCaja(integ.accessToken, integ.externalPosId)
        : null;
      const ok = String(yo.id) === integ.mpUserId && !!caja;
      if (!ok)
        await req.db((tx) =>
          tx
            .updateTable('integraciones')
            .set({ estado: 'requiere_atencion', updated_at: new Date() })
            .where('id', '=', integ.id)
            .execute(),
        );
      return { ok };
    } catch {
      await req.db((tx) =>
        tx
          .updateTable('integraciones')
          .set({ estado: 'requiere_atencion', updated_at: new Date() })
          .where('id', '=', integ.id)
          .execute(),
      );
      return { ok: false };
    }
  });

  app.post('/api/v1/mp/desconectar', { config: { roles: ['dueno'] } }, async (req) => {
    validar(z.strictObject({}).optional(), req.body);
    await req.db(async (tx) => {
      await tx
        .updateTable('integraciones')
        .set({
          estado: 'desconectado',
          access_token_cifrado: null,
          refresh_token_cifrado: null,
          vence_en: null,
          updated_at: new Date(),
        })
        .where('proveedor', '=', 'mercadopago')
        .execute();
      await auditar(tx, req.completa, 'mp.desconectado', {}, req.ip);
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ cobro con QR
  app.post('/api/v1/cobros/qr', { config: { roles: VENDEN } }, async (req) => {
    const mp = mpOError(app);
    const d = validar(
      z.strictObject({
        ventaId: z.uuid(),
        pagoId: z.uuid(),
        turnoId: z.uuid(),
        creadaEn: z.iso.datetime({ offset: true }),
        total: centavos,
        items: z
          .array(
            z.strictObject({
              id: z.uuid(),
              productoId: z.uuid().nullable(),
              descripcion: z.string().trim().min(1).max(120),
              cantidad: z.number().positive().max(100_000),
              precioUnitario: centavos,
            }),
          )
          .min(1)
          .max(300),
      }),
      req.body,
    );
    const s = req.completa;
    if (
      d.items.reduce((t, i) => t + subtotal(i.cantidad, i.precioUnitario), 0) !== d.total ||
      d.total <= 0
    ) {
      throw new ErrorPublico(400, 'datos_invalidos', 'El total no coincide con los productos.');
    }

    // 1) Venta abierta con su pago pendiente (idempotente por el ID de la venta).
    const preparada = await req.db(async (tx) => {
      const integ = await integracionDelKiosco(tx, app.cifrador);
      if (!integ?.externalPosId || integ.estado !== 'conectado') throw sinConexionMp();
      const existente = await tx
        .selectFrom('pagos')
        .select(['id', 'estado', 'mp_qr_data', 'mp_order_id'])
        .where('id', '=', d.pagoId)
        .executeTakeFirst();
      if (existente) return { integ, existente, kiosco: '' };
      const turno = await tx
        .selectFrom('turnos_caja')
        .select('id')
        .where('id', '=', d.turnoId)
        .executeTakeFirst();
      if (!turno) throw noEncontrado();
      const ids = [...new Set(d.items.map((i) => i.productoId).filter((x): x is string => !!x))];
      if (
        ids.length &&
        (await tx.selectFrom('productos').select('id').where('id', 'in', ids).execute()).length !==
          ids.length
      )
        throw noEncontrado();
      await tx
        .insertInto('ventas')
        .values({
          id: d.ventaId,
          kiosco_id: s.kioscoId,
          turno_id: d.turnoId,
          usuario_id: s.usuarioId,
          dispositivo_id: s.dispositivoId,
          total: d.total,
          estado: 'abierta',
          creada_en_dispositivo: d.creadaEn,
        })
        .execute();
      for (const i of d.items) {
        await tx
          .insertInto('venta_items')
          .values({
            id: i.id,
            kiosco_id: s.kioscoId,
            venta_id: d.ventaId,
            producto_id: i.productoId,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            precio_unitario: i.precioUnitario,
            subtotal: subtotal(i.cantidad, i.precioUnitario),
          })
          .execute();
      }
      await tx
        .insertInto('pagos')
        .values({
          id: d.pagoId,
          kiosco_id: s.kioscoId,
          venta_id: d.ventaId,
          medio: 'qr_mp',
          monto: d.total,
          estado: 'pendiente',
          vence_en: new Date(Date.now() + 10 * 60_000),
        })
        .execute();
      const kiosco = (await tx.selectFrom('kioscos').select('nombre').executeTakeFirstOrThrow())
        .nombre;
      return { integ, existente: null, kiosco };
    });
    if (preparada.existente?.mp_qr_data)
      return {
        pagoId: d.pagoId,
        qr: preparada.existente.mp_qr_data,
        estado: preparada.existente.estado,
      };

    // 2) Orden en Mercado Pago. La clave de idempotencia sale del ID del pago: reintentar no crea dos.
    let orden;
    try {
      orden = await mp.cliente.crearOrdenQr(preparada.integ.accessToken, {
        idempotencia: d.pagoId,
        externalReference: d.ventaId,
        externalPosId: preparada.integ.externalPosId ?? '',
        totalCentavos: d.total,
        descripcion: preparada.kiosco || 'Compra',
        items: d.items.map((i) => ({
          titulo: i.descripcion,
          precioCentavos: i.precioUnitario,
          cantidad: i.cantidad,
        })),
      });
    } catch (error) {
      req.log.error({ err: error }, 'No se pudo crear la orden QR');
      await req.db(async (tx) => {
        await tx
          .updateTable('pagos')
          .set({ estado: 'cancelado', updated_at: new Date() })
          .where('id', '=', d.pagoId)
          .where('estado', '=', 'pendiente')
          .execute();
        await tx
          .updateTable('ventas')
          .set({
            estado: 'anulada',
            anulada_en: new Date(),
            motivo_anulacion: 'No se pudo crear el QR',
          })
          .where('id', '=', d.ventaId)
          .where('estado', '=', 'abierta')
          .execute();
      });
      throw errorQr();
    }
    const qr = orden.type_response?.qr_data;
    if (!qr) throw errorQr();
    await req.db((tx) =>
      tx
        .updateTable('pagos')
        .set({ mp_order_id: orden.id, mp_qr_data: qr, updated_at: new Date() })
        .where('id', '=', d.pagoId)
        .execute(),
    );
    // Solo el dato del QR: la app lo dibuja localmente.
    return { pagoId: d.pagoId, qr, estado: 'pendiente' };
  });

  // Estado del pago. Lo actualiza el servidor (webhook y reconsulta), nunca el cliente.
  app.get('/api/v1/pagos/:id', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const leer = () =>
      req.db((tx) =>
        tx
          .selectFrom('pagos')
          .select([
            'id',
            'estado',
            'confirmado_en',
            'ultima_consulta',
            'mp_order_id',
            'venta_id',
            'vence_en',
          ])
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    let p = await leer();
    if (!p) throw noEncontrado();
    if (
      app.mp &&
      p.estado === 'pendiente' &&
      p.mp_order_id &&
      (!p.ultima_consulta || Date.now() - p.ultima_consulta.getTime() > 3000)
    ) {
      await reconsultarPago(
        app.base,
        app.cifrador,
        app.mp.cliente,
        req.completa.kioscoId,
        id,
      ).catch((err: unknown) => req.log.warn({ err }, 'Reconsulta de pago'));
      p = (await leer()) ?? p;
    }
    const venta = await req.db((tx) =>
      tx
        .selectFrom('ventas')
        .select('estado')
        .where('id', '=', p.venta_id)
        .executeTakeFirstOrThrow(),
    );
    return {
      estado: p.estado,
      confirmadoEn: p.confirmado_en,
      venceEn: p.vence_en,
      ventaEstado: venta.estado,
    };
  });

  app.post('/api/v1/pagos/:id/cancelar', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    validar(z.strictObject({}).optional(), req.body);
    const datos = await req.db(async (tx) => {
      const p = await tx
        .selectFrom('pagos')
        .select(['estado', 'mp_order_id', 'venta_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      return { p, integ: await integracionDelKiosco(tx, app.cifrador) };
    });
    if (datos.p.estado !== 'pendiente') return { estado: datos.p.estado };
    const mp = mpOError(app);
    if (datos.p.mp_order_id && datos.integ) {
      try {
        await mp.cliente.cancelarOrden(
          datos.integ.accessToken,
          datos.p.mp_order_id,
          `cancelar-${id}`,
        );
      } catch (error) {
        // Si ya estaba pagada, la reconsulta lo va a reflejar.
        req.log.warn({ err: error }, 'No se pudo cancelar la orden');
      }
      const r = await reconsultarPago(
        app.base,
        app.cifrador,
        mp.cliente,
        req.completa.kioscoId,
        id,
      ).catch(() => 'pendiente' as const);
      if (r === 'aprobado') return { estado: 'aprobado' };
    }
    await req.db(async (tx) => {
      await tx
        .updateTable('pagos')
        .set({ estado: 'cancelado', updated_at: new Date() })
        .where('id', '=', id)
        .where('estado', '=', 'pendiente')
        .execute();
      await tx
        .updateTable('ventas')
        .set({
          estado: 'anulada',
          anulada_en: new Date(),
          motivo_anulacion: 'Cobro con QR cancelado',
        })
        .where('id', '=', datos.p.venta_id)
        .where('estado', 'in', ['abierta', 'pendiente_cobro'])
        .execute();
    });
    return { estado: 'cancelado' };
  });

  // ------------------------------------------------------------------ pendientes de cobro
  app.get('/api/v1/ventas/pendientes', { config: { roles: ['dueno', 'encargado'] } }, async (req) =>
    req.db((tx) =>
      tx
        .selectFrom('ventas as v')
        .leftJoin('usuarios as u', 'u.id', 'v.usuario_id')
        .select([
          'v.id',
          'v.total',
          'v.estado',
          'v.devolucion_pendiente',
          'v.creada_en_dispositivo',
          'u.nombre',
        ])
        .where((eb) =>
          eb.or([eb('v.estado', '=', 'pendiente_cobro'), eb('v.devolucion_pendiente', '=', true)]),
        )
        .orderBy('v.creada_en_dispositivo', 'desc')
        .limit(100)
        .execute(),
    ),
  );

  app.post(
    '/api/v1/ventas/:id/resolver',
    { config: { roles: ['dueno', 'encargado'] } },
    async (req) => {
      const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
      const { accion } = validar(
        z.strictObject({ accion: z.enum(['efectivo', 'transferencia', 'anular']) }),
        req.body,
      );
      const s = req.completa;
      return req.db(async (tx) => {
        const v = await tx
          .selectFrom('ventas')
          .select(['id', 'estado', 'total', 'usuario_id'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!v) throw noEncontrado();
        if (v.estado !== 'pendiente_cobro')
          throw new ErrorPublico(409, 'no_pendiente', 'Esta venta ya no está pendiente de cobro.');
        // Antes de resolver, la orden QR se da por terminada para no cobrar dos veces.
        await tx
          .updateTable('pagos')
          .set({ estado: 'vencido', updated_at: new Date() })
          .where('venta_id', '=', id)
          .where('estado', '=', 'pendiente')
          .execute();
        if (accion === 'anular') {
          await tx
            .updateTable('ventas')
            .set({
              estado: 'anulada',
              anulada_por: s.usuarioId,
              anulada_en: new Date(),
              motivo_anulacion: 'Cobro con QR sin confirmar',
            })
            .where('id', '=', id)
            .execute();
        } else {
          await tx
            .insertInto('pagos')
            .values({
              id: uuidv7(),
              kiosco_id: s.kioscoId,
              venta_id: id,
              medio: accion,
              monto: v.total,
              recibido: accion === 'efectivo' ? v.total : null,
              vuelto: accion === 'efectivo' ? 0 : null,
              estado: 'aprobado',
              confirmado_en: new Date(),
            })
            .execute();
          await tx.updateTable('ventas').set({ estado: 'cobrada' }).where('id', '=', id).execute();
          const items = await tx
            .selectFrom('venta_items')
            .select(['producto_id', 'cantidad'])
            .where('venta_id', '=', id)
            .execute();
          for (const i of items) {
            if (i.producto_id)
              await moverStock(tx, {
                kioscoId: s.kioscoId,
                productoId: i.producto_id,
                tipo: 'venta',
                cantidad: -Number(i.cantidad),
                usuarioId: v.usuario_id,
                ventaId: id,
              });
          }
        }
        await auditar(tx, s, 'venta.resuelta', { venta: id, accion }, req.ip);
        return { ok: true };
      });
    },
  );

  // ------------------------------------------------------------------ webhook
  // Única ruta pública sin sesión que modifica algo: firma verificada, respuesta rápida y
  // reconsulta en la API antes de cambiar cualquier estado. Nunca se confía en el cuerpo.
  app.post(
    '/api/v1/webhooks/mercadopago',
    { config: { publica: true, sinOrigen: true, rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply) => {
      const mp = app.mp;
      if (!mp) return reply.code(404).send();
      const dataId = (req.query as Record<string, unknown>)['data.id'];
      const ok = verificarFirma({
        xSignature: req.headers['x-signature'] as string | undefined,
        xRequestId: req.headers['x-request-id'] as string | undefined,
        dataId: typeof dataId === 'string' ? dataId : undefined,
        secreto: mp.config.webhookSecret,
      });
      if (!ok || typeof dataId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(dataId))
        return reply.code(401).send({ error: 'Firma inválida' });
      const cuerpo = (req.body ?? {}) as { id?: unknown; type?: unknown };
      const tipo =
        typeof cuerpo.type === 'string'
          ? cuerpo.type
          : (req.query as Record<string, unknown>)['type'];
      if (tipo !== 'order' && tipo !== 'orders') return reply.code(200).send({ ok: true });
      const eventoId =
        `${String(cuerpo.id ?? '')}:${dataId}:${req.headers['x-request-id'] ?? ''}`.slice(0, 200);
      const nuevo = await app.registrarEventoWebhook(eventoId);
      if (nuevo) await app.encolarOrdenMp(dataId);
      return reply.code(200).send({ ok: true });
    },
  );
}
