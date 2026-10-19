// Ventas: sincronización idempotente desde el equipo, historial y anulación (secciones 10 y 12).
import type { FastifyInstance } from 'fastify';
import { sql } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { devueltoPorItem } from '../servicios/promos.ts';
import {
  avisosDeVentas,
  datosDeVenta,
  eventosEsperados,
  type AvisoPendiente,
} from '../servicios/avisos.ts';
import { alAnularVenta, comprobantesDeVenta, facturasDeVentas } from '../servicios/facturacion.ts';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { moverStock } from '../servicios/stock.ts';
import {
  esquemaApertura,
  esquemaGasto,
  esquemaVenta,
  registrarApertura,
  registrarGasto,
  registrarVenta,
  type ResultadoOp,
} from '../servicios/ventas.ts';
import { validar } from '../validar.ts';

const VENDEN = ['dueno', 'encargado', 'cajero'] as const;

const operacion = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('apertura'), datos: esquemaApertura }),
  z.strictObject({ tipo: z.literal('venta'), datos: esquemaVenta }),
  z.strictObject({ tipo: z.literal('gasto'), datos: esquemaGasto }),
]);

export async function rutasVentas(app: FastifyInstance): Promise<void> {
  // Lote de operaciones del equipo. Cada una va en su propio savepoint: si una falla, las demás
  // se guardan igual. Reenviar el mismo lote responde "ya_existia" y no duplica nada.
  app.post(
    '/api/v1/sync',
    { config: { roles: VENDEN }, bodyLimit: 2 * 1024 * 1024 },
    async (req) => {
      const crudo = validar(
        z.strictObject({ ops: z.array(z.unknown()).min(1).max(200) }),
        req.body,
      );
      const s = req.completa;
      const resultados: (ResultadoOp & { id: string })[] = [];
      const ventasNuevas: string[] = [];
      const avisos = await req.db(async (tx) => {
        for (const [n, op] of crudo.ops.entries()) {
          const r = operacion.safeParse(op);
          const id = (op as { datos?: { id?: unknown } })?.datos?.id;
          const idTexto = typeof id === 'string' ? id : `#${n}`;
          if (!r.success) {
            resultados.push({ id: idTexto, estado: 'rechazada', mensaje: 'Datos inválidos.' });
            continue;
          }
          await sql`savepoint op`.execute(tx);
          try {
            const res =
              r.data.tipo === 'apertura'
                ? await registrarApertura(tx, s, r.data.datos)
                : r.data.tipo === 'venta'
                  ? await registrarVenta(tx, s, r.data.datos)
                  : await registrarGasto(tx, s, r.data.datos);
            if (res.estado === 'rechazada') await sql`rollback to savepoint op`.execute(tx);
            else await sql`release savepoint op`.execute(tx);
            if (r.data.tipo === 'venta' && res.estado === 'ok') ventasNuevas.push(r.data.datos.id);
            resultados.push({ id: idTexto, ...res });
          } catch (error) {
            await sql`rollback to savepoint op`.execute(tx);
            const e = error as { code?: string };
            // Un ID que ya existe en otro kiosco (no debería pasar con UUIDv7) se rechaza sin decir más.
            if (e.code === '23505' || e.code === '23503') {
              resultados.push({ id: idTexto, estado: 'rechazada', mensaje: 'No se pudo guardar.' });
            } else {
              throw error;
            }
          }
        }
        const facturas = await facturasDeVentas(
          tx,
          s.kioscoId,
          ventasNuevas,
          app.facturacion?.facturador.prueba ?? true,
        );
        return { avisos: await avisosDeVentas(tx, ventasNuevas), facturas };
      });
      await app.avisar(s.kioscoId, avisos.avisos);
      await app.encolarFacturas(s.kioscoId, avisos.facturas);
      return { resultados };
    },
  );

  app.get(
    '/api/v1/ventas',
    { config: { roles: ['dueno', 'encargado', 'cajero', 'soporte'] } },
    async (req) => {
      const { turnoId, desde, hasta } = validar(
        z.strictObject({
          turnoId: z.uuid().optional(),
          desde: z.iso.date().optional(),
          hasta: z.iso.date().optional(),
        }),
        req.query,
      );
      const s = req.completa;
      return req.db(async (tx) => {
        let q = tx
          .selectFrom('ventas as v')
          .leftJoin('usuarios as u', 'u.id', 'v.usuario_id')
          .select([
            'v.id',
            'v.total',
            'v.estado',
            'v.devolucion_pendiente',
            'v.creada_en_dispositivo',
            'v.motivo_anulacion',
            'v.turno_id',
            'v.regalo',
            'u.nombre',
          ])
          .select(({ exists, selectFrom }) =>
            exists(
              selectFrom('devoluciones as d')
                .select('d.id')
                .whereRef('d.venta_id', '=', 'v.id')
                .whereRef('d.kiosco_id', '=', 'v.kiosco_id'),
            ).as('cambio'),
          )
          .orderBy('v.creada_en_dispositivo', 'desc')
          .limit(300);
        if (turnoId) q = q.where('v.turno_id', '=', turnoId);
        if (desde)
          q = q.where('v.creada_en_dispositivo', '>=', new Date(`${desde}T00:00:00-03:00`));
        if (hasta)
          q = q.where(
            'v.creada_en_dispositivo',
            '<',
            new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000),
          );
        // El cajero ve solo las ventas del turno abierto.
        if (s.rol === 'cajero') {
          q = q.where(
            'v.turno_id',
            'in',
            tx.selectFrom('turnos_caja').select('id').where('cerrado_en', 'is', null),
          );
        }
        const ventas = await q.execute();
        const ids = ventas.map((v) => v.id);
        const pagos = ids.length
          ? await tx
              .selectFrom('pagos')
              .select(['venta_id', 'medio', 'monto', 'estado'])
              .where('venta_id', 'in', ids)
              .execute()
          : [];
        const facturas = ids.length
          ? await tx
              .selectFrom('comprobantes')
              .select(['venta_id', 'tipo', 'punto_venta', 'numero', 'estado'])
              .where('venta_id', 'in', ids)
              .where('anula_id', 'is', null)
              .execute()
          : [];
        return ventas.map((v) => {
          const f = facturas.find((x) => x.venta_id === v.id);
          return {
            ...v,
            medios: [...new Set(pagos.filter((p) => p.venta_id === v.id).map((p) => p.medio))],
            factura: f
              ? { tipo: f.tipo, puntoDeVenta: f.punto_venta, numero: f.numero, estado: f.estado }
              : null,
          };
        });
      });
    },
  );

  app.get(
    '/api/v1/ventas/:id',
    { config: { roles: ['dueno', 'encargado', 'cajero', 'soporte'] } },
    async (req) => {
      const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
      return req.db(async (tx) => {
        const v = await tx.selectFrom('ventas').selectAll().where('id', '=', id).executeTakeFirst();
        if (!v) throw noEncontrado();
        // El cajero ve solo las ventas del turno abierto, igual que en la lista.
        if (req.completa.rol === 'cajero') {
          const turno = await tx
            .selectFrom('turnos_caja')
            .select('cerrado_en')
            .where('id', '=', v.turno_id)
            .executeTakeFirst();
          if (turno?.cerrado_en) throw noEncontrado();
        }
        const items = await tx
          .selectFrom('venta_items')
          .select(['id', 'producto_id', 'descripcion', 'cantidad', 'precio_unitario', 'subtotal'])
          .where('venta_id', '=', id)
          .orderBy('id')
          .execute();
        const pagos = await tx
          .selectFrom('pagos')
          .select(['id', 'medio', 'monto', 'recibido', 'vuelto', 'estado', 'confirmado_en'])
          .where('venta_id', '=', id)
          .execute();
        const descuentos = await tx
          .selectFrom('venta_descuentos')
          .select(['promo_id', 'descripcion', 'monto'])
          .where('venta_id', '=', id)
          .execute();
        const devoluciones = await tx
          .selectFrom('devoluciones')
          .select(['venta_item_id', 'producto_id', 'descripcion', 'cantidad', 'importe'])
          .where('venta_id', '=', id)
          .execute();
        return {
          ...v,
          items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad) })),
          pagos,
          descuentos,
          devoluciones: devoluciones.map((d) => ({ ...d, cantidad: Number(d.cantidad) })),
          comprobantes: await comprobantesDeVenta(tx, id),
        };
      });
    },
  );

  // Anulación: solo dueño y encargado (el encargado, solo las del día). Revierte el stock.
  app.post(
    '/api/v1/ventas/:id/anular',
    { config: { roles: ['dueno', 'encargado'] } },
    async (req) => {
      const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
      const { motivo } = validar(
        z.strictObject({ motivo: z.string().trim().min(3).max(200) }),
        req.body,
      );
      const s = req.completa;
      const r = await req.db(async (tx) => {
        const v = await tx
          .selectFrom('ventas')
          .select(['id', 'estado', 'creada_en_dispositivo'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!v) throw noEncontrado();
        if (v.estado === 'anulada')
          throw new ErrorPublico(409, 'ya_anulada', 'Esta venta ya está anulada.');
        if (s.rol === 'encargado') {
          const hoy = new Date().toLocaleDateString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
          });
          const dia = v.creada_en_dispositivo.toLocaleDateString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
          });
          if (hoy !== dia)
            throw new ErrorPublico(
              403,
              'sin_permiso',
              'El encargado solo puede anular ventas del día. Pedíselo al dueño.',
            );
        }
        const items = await tx
          .selectFrom('venta_items')
          .select(['id', 'producto_id', 'cantidad'])
          .where('venta_id', '=', id)
          .execute();
        // Si algo de esta venta se cambió, la plata de lo devuelto ya pasó al cambio: anularla
        // la devolvería dos veces. Primero se anula el cambio.
        const yaDevuelto = await devueltoPorItem(tx, id);
        if ([...yaDevuelto.values()].some((n) => n > 0))
          throw new ErrorPublico(
            409,
            'tiene_cambio',
            'Algo de esta venta ya se cambió. Primero anulá el cambio y después esta venta.',
          );
        for (const i of items) {
          const cantidad =
            Math.round((Number(i.cantidad) - (yaDevuelto.get(i.id) ?? 0)) * 1000) / 1000;
          if (i.producto_id && cantidad > 0) {
            await moverStock(tx, {
              kioscoId: s.kioscoId,
              productoId: i.producto_id,
              tipo: 'anulacion',
              cantidad,
              usuarioId: s.usuarioId,
              ventaId: id,
              motivo,
            });
          }
        }
        // Si era un cambio, lo que había vuelto al stock sale otra vez.
        const devueltos = await tx
          .selectFrom('devoluciones')
          .select(['producto_id', 'cantidad'])
          .where('venta_id', '=', id)
          .execute();
        for (const d of devueltos) {
          if (d.producto_id)
            await moverStock(tx, {
              kioscoId: s.kioscoId,
              productoId: d.producto_id,
              tipo: 'anulacion',
              cantidad: -Number(d.cantidad),
              usuarioId: s.usuarioId,
              ventaId: id,
              motivo,
            });
        }
        // Lo que se había anotado a cuenta se descuenta de la deuda del cliente.
        const cargo = await tx
          .selectFrom('movimientos_cuenta')
          .select(['cliente_id', 'monto'])
          .where('venta_id', '=', id)
          .where('tipo', '=', 'venta')
          .executeTakeFirst();
        if (cargo) {
          await tx
            .insertInto('movimientos_cuenta')
            .values({
              id: uuidv7(),
              kiosco_id: s.kioscoId,
              cliente_id: cargo.cliente_id,
              tipo: 'anulacion',
              monto: -cargo.monto,
              venta_id: id,
              usuario_id: s.usuarioId,
              nota: motivo.slice(0, 200),
            })
            .execute();
        }
        const qr = await tx
          .selectFrom('pagos')
          .select('id')
          .where('venta_id', '=', id)
          .where('medio', '=', 'qr_mp')
          .where('estado', '=', 'aprobado')
          .executeTakeFirst();
        // Con QR, en la V1 la devolución se hace desde la app de Mercado Pago.
        await tx
          .updateTable('ventas')
          .set({
            estado: 'anulada',
            anulada_por: s.usuarioId,
            anulada_en: new Date(),
            motivo_anulacion: motivo,
            devolucion_pendiente: !!qr,
          })
          .where('id', '=', id)
          .execute();
        await auditar(tx, s, 'venta.anulada', { venta: id, motivo }, req.ip);
        const avisos: AvisoPendiente[] = [];
        if ((await eventosEsperados(tx, ['venta.anulada'])).size) {
          const datos = await datosDeVenta(tx, id);
          if (datos) avisos.push({ evento: 'venta.anulada', datos });
        }
        // Si tenía factura, sale la nota de crédito (o se cancela si todavía no había salido).
        const nota = await alAnularVenta(tx, s.kioscoId, id);
        return { ok: true, devolucionPendiente: !!qr, avisos, nota };
      });
      await app.avisar(s.kioscoId, r.avisos);
      if (r.nota) await app.encolarFacturas(s.kioscoId, [r.nota]);
      return { ok: r.ok, devolucionPendiente: r.devolucionPendiente };
    },
  );

  app.post('/api/v1/ventas/:id/devuelta', { config: { roles: ['dueno'] } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    validar(z.strictObject({}).optional(), req.body);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('ventas')
        .set({ devolucion_pendiente: false })
        .where('id', '=', id)
        .where('devolucion_pendiente', '=', true)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await tx
        .updateTable('pagos')
        .set({ estado: 'devuelto', updated_at: new Date() })
        .where('venta_id', '=', id)
        .where('medio', '=', 'qr_mp')
        .execute();
      await auditar(tx, req.completa, 'venta.devuelta', { venta: id }, req.ip);
    });
    return { ok: true };
  });
}
