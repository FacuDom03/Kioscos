// Clientes y cuenta corriente / fiado (etapa I5, docs/decisiones/009-rubros.md).
import { formatearPlata, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { sql } from '@mostrador/db';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { clienteParaCuenta, saldoDe } from '../servicios/clientes.ts';
import { turnoAbierto } from '../servicios/ventas.ts';
import { validar } from '../validar.ts';

const VENDEN = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const EDITAN = ['dueno', 'encargado', 'soporte'] as const;
const centavos = z.number().int().min(0).max(100_000_000_000);
const idParam = z.strictObject({ id: z.uuid() });

const datosCliente = {
  nombre: z.string().trim().min(1).max(80),
  telefono: z
    .string()
    .trim()
    .regex(/^[0-9 +()-]{6,30}$/, 'Teléfono inválido')
    .nullable()
    .optional(),
  nota: z.string().trim().min(1).max(200).nullable().optional(),
  limite: centavos.nullable().optional(),
};

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function rutasClientes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/clientes', { config: { roles: VENDEN } }, async (req) => {
    const { q, deben } = validar(
      z.strictObject({
        q: z.string().trim().max(80).optional(),
        deben: z.enum(['si', 'no']).optional(),
      }),
      req.query,
    );
    return req.db(async (tx) => {
      const saldo = sql<string>`coalesce((select sum(m.monto) from movimientos_cuenta m
        where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id), 0)`;
      let consulta = tx
        .selectFrom('clientes as c')
        .select(['c.id', 'c.nombre', 'c.telefono', 'c.nota', 'c.limite'])
        .select(saldo.as('saldo'))
        .select(
          sql<Date | null>`(select max(m.created_at) from movimientos_cuenta m
            where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id)`.as('ultimo'),
        )
        .where('c.activo', '=', true)
        .orderBy(sql`lower(c.nombre)`)
        .limit(300);
      if (q)
        consulta = consulta.where(
          sql`lower(c.nombre)`,
          'like',
          `%${escaparLike(q.toLowerCase())}%`,
        );
      if (deben === 'si') consulta = consulta.where(saldo, '>', '0');
      const filas = await consulta.execute();
      const total = await tx
        .selectFrom('movimientos_cuenta')
        .select((eb) => eb.fn.sum<string>('monto').as('t'))
        .executeTakeFirst();
      return {
        totalDeuda: Number(total?.t ?? 0),
        clientes: filas.map((f) => ({ ...f, saldo: Number(f.saldo) })),
      };
    });
  });

  app.post('/api/v1/clientes', { config: { roles: VENDEN } }, async (req) => {
    const d = validar(z.strictObject({ id: z.uuid().optional(), ...datosCliente }), req.body);
    const s = req.completa;
    // El límite lo pone el dueño o el encargado.
    if (d.limite != null && s.rol === 'cajero')
      throw new ErrorPublico(403, 'sin_permiso', 'El límite lo pone el dueño o el encargado.');
    const id = d.id ?? uuidv7();
    return req.db(async (tx) => {
      const ya = await tx
        .selectFrom('clientes')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (ya) return { id };
      await tx
        .insertInto('clientes')
        .values({
          id,
          kiosco_id: s.kioscoId,
          nombre: d.nombre,
          telefono: d.telefono ?? null,
          nota: d.nota ?? null,
          limite: d.limite ?? null,
        })
        .execute();
      return { id };
    });
  });

  app.patch('/api/v1/clientes/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({
        nombre: datosCliente.nombre.optional(),
        telefono: datosCliente.telefono,
        nota: datosCliente.nota,
        limite: datosCliente.limite,
        activo: z.boolean().optional(),
      }),
      req.body,
    );
    return req.db(async (tx) => {
      const c = await tx
        .selectFrom('clientes')
        .select(['id', 'limite'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      await tx
        .updateTable('clientes')
        .set({ ...d, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      if (d.limite !== undefined && d.limite !== c.limite)
        await auditar(
          tx,
          req.completa,
          'cliente.limite',
          { cliente: id, limite: d.limite },
          req.ip,
        );
      return { ok: true };
    });
  });

  app.get('/api/v1/clientes/:id', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    return req.db(async (tx) => {
      const c = await tx
        .selectFrom('clientes')
        .select(['id', 'nombre', 'telefono', 'nota', 'limite', 'activo', 'created_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      const movimientos = await tx
        .selectFrom('movimientos_cuenta as m')
        .leftJoin('usuarios as u', 'u.id', 'm.usuario_id')
        .select([
          'm.id',
          'm.tipo',
          'm.monto',
          'm.medio',
          'm.venta_id',
          'm.nota',
          'm.created_at',
          'u.nombre as por',
        ])
        .where('m.cliente_id', '=', id)
        .orderBy('m.created_at', 'desc')
        .orderBy('m.id', 'desc')
        .limit(200)
        .execute();
      const saldo = await saldoDe(tx, id);
      return { ...c, saldo, movimientos };
    });
  });

  // Pago a cuenta. El efectivo entra en la caja abierta.
  app.post('/api/v1/clientes/:id/pagos', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({
        id: z.uuid(),
        monto: centavos.refine((n) => n > 0),
        medio: z.enum(['efectivo', 'transferencia']),
        nota: z.string().trim().min(1).max(200).optional(),
      }),
      req.body,
    );
    const s = req.completa;
    return req.db(async (tx) => {
      const c = await clienteParaCuenta(tx, id);
      if (!c) throw noEncontrado();
      const ya = await tx
        .selectFrom('movimientos_cuenta')
        .select('id')
        .where('id', '=', d.id)
        .executeTakeFirst();
      if (!ya) {
        const turno = await turnoAbierto(tx);
        if (d.medio === 'efectivo' && !turno)
          throw new ErrorPublico(409, 'sin_caja', 'Abrí la caja para cobrar en efectivo.');
        await tx
          .insertInto('movimientos_cuenta')
          .values({
            id: d.id,
            kiosco_id: s.kioscoId,
            cliente_id: id,
            tipo: 'pago',
            monto: -d.monto,
            medio: d.medio,
            turno_id: turno?.id ?? null,
            usuario_id: s.usuarioId,
            nota: d.nota ?? null,
          })
          .execute();
      }
      const saldo = await saldoDe(tx, id);
      return {
        saldo,
        mensaje:
          saldo > 0
            ? `${c.nombre} todavía debe ${formatearPlata(saldo)}.`
            : saldo < 0
              ? `${c.nombre} queda con ${formatearPlata(-saldo)} a favor.`
              : `${c.nombre} quedó al día.`,
      };
    });
  });
}
