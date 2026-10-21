// Clientes y cuenta corriente / fiado (etapa I5, docs/decisiones/009-rubros.md).
import { cuitValido, formatearPlata, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { sql, type TxKiosco } from '@mostrador/db';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { clienteParaCuenta, saldoDe } from '../servicios/clientes.ts';
import { turnoAbierto } from '../servicios/ventas.ts';
import { validar } from '../validar.ts';
import { tieneModulo } from '../servicios/negocio.ts';

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
  // Para facturarle a su nombre (con la facturación prendida).
  documento: z
    .strictObject({
      tipo: z.enum(['cuit', 'cuil', 'dni']),
      numero: z
        .string()
        .trim()
        .regex(/^\d{7,11}$/),
    })
    .nullable()
    .optional(),
  condicionIva: z
    .enum(['consumidor_final', 'monotributo', 'responsable_inscripto', 'exento'])
    .nullable()
    .optional(),
  domicilio: z.string().trim().min(1).max(200).nullable().optional(),
};

type DatosFiscales = {
  documento?: { tipo: 'cuit' | 'cuil' | 'dni'; numero: string } | null | undefined;
  condicionIva?:
    'consumidor_final' | 'monotributo' | 'responsable_inscripto' | 'exento' | null | undefined;
  domicilio?: string | null | undefined;
};

/** Revisa el documento y lo pasa a columnas. Un DNI es siempre de un consumidor final. */
function columnasFiscales(d: DatosFiscales) {
  const doc = d.documento;
  if (doc && doc.tipo !== 'dni' && !cuitValido(doc.numero))
    throw new ErrorPublico(400, 'documento', 'El CUIT no es válido: revisá los números.');
  if (doc?.tipo === 'dni' && !/^\d{7,8}$/.test(doc.numero))
    throw new ErrorPublico(400, 'documento', 'El DNI tiene 7 u 8 números.');
  return {
    ...(doc !== undefined ? { doc_tipo: doc?.tipo ?? null, doc_nro: doc?.numero ?? null } : {}),
    ...(d.condicionIva !== undefined || doc?.tipo === 'dni'
      ? {
          condicion_iva:
            doc?.tipo === 'dni' ? ('consumidor_final' as const) : (d.condicionIva ?? null),
        }
      : {}),
    ...(d.domicilio !== undefined ? { domicilio: d.domicilio ?? null } : {}),
  };
}

async function documentoRepetido(
  tx: TxKiosco,
  doc: { doc_tipo?: string | null; doc_nro?: string | null },
  salvo?: string,
) {
  if (!doc.doc_nro || !doc.doc_tipo) return;
  let q = tx
    .selectFrom('clientes')
    .select('id')
    .where('doc_tipo', '=', doc.doc_tipo as 'cuit')
    .where('doc_nro', '=', doc.doc_nro)
    .where('activo', '=', true);
  if (salvo) q = q.where('id', '<>', salvo);
  if (await q.executeTakeFirst())
    throw new ErrorPublico(409, 'documento_repetido', 'Ya hay un cliente con ese CUIT o DNI.');
}

/** Clientes: con la cuenta corriente o con la facturación (para facturar a su nombre). */
async function exigirClientes(tx: TxKiosco) {
  if (!(await tieneModulo(tx, 'cuenta_corriente')) && !(await tieneModulo(tx, 'facturacion')))
    throw new ErrorPublico(
      403,
      'sin_funcion',
      'Los clientes vienen con la cuenta corriente o la facturación. Las activa el dueño en Más → Tu negocio.',
    );
}

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function rutasClientes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/clientes', { config: { roles: VENDEN } }, async (req) => {
    const { q, deben, conDocumento } = validar(
      z.strictObject({
        q: z.string().trim().max(80).optional(),
        deben: z.enum(['si', 'no']).optional(),
        // Para elegir a quién facturarle: solo los que tienen CUIT o DNI.
        conDocumento: z.enum(['si']).optional(),
      }),
      req.query,
    );
    return req.db(async (tx) => {
      const saldo = sql<string>`coalesce((select sum(m.monto) from movimientos_cuenta m
        where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id), 0)`;
      let consulta = tx
        .selectFrom('clientes as c')
        .select([
          'c.id',
          'c.nombre',
          'c.telefono',
          'c.nota',
          'c.limite',
          'c.doc_tipo',
          'c.doc_nro',
          'c.condicion_iva',
          'c.domicilio',
        ])
        .select(saldo.as('saldo'))
        .select(
          sql<Date | null>`(select max(m.created_at) from movimientos_cuenta m
            where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id)`.as('ultimo'),
        )
        .where('c.activo', '=', true)
        .orderBy(sql`lower(c.nombre)`)
        .limit(300);
      if (q) {
        const numeros = q.replace(/\D/g, '');
        consulta = consulta.where((eb) =>
          eb.or([
            eb(sql`lower(c.nombre)`, 'like', `%${escaparLike(q.toLowerCase())}%`),
            ...(numeros.length >= 3 ? [eb('c.doc_nro', 'like', `${numeros}%`)] : []),
          ]),
        );
      }
      if (conDocumento) consulta = consulta.where('c.doc_nro', 'is not', null);
      if (deben === 'si') consulta = consulta.where(saldo, '>', '0');
      const filas = await consulta.execute();
      // Lo que se debe en total: solo los saldos deudores de clientes activos (la plata a favor
      // de uno no descuenta la deuda de otro).
      const total = await sql<{ t: string | null }>`
        select sum(s.saldo) as t from (
          select sum(m.monto) as saldo
          from movimientos_cuenta m
          join clientes c on c.kiosco_id = m.kiosco_id and c.id = m.cliente_id
          where c.activo
          group by m.cliente_id
          having sum(m.monto) > 0
        ) s`.execute(tx);
      return {
        totalDeuda: Number(total.rows[0]?.t ?? 0),
        clientes: filas.map((f) => ({ ...f, saldo: Number(f.saldo) })),
      };
    });
  });

  app.post('/api/v1/clientes', { config: { roles: VENDEN } }, async (req) => {
    const d = validar(z.strictObject({ id: z.uuid().optional(), ...datosCliente }), req.body);
    const s = req.completa;
    // El límite lo pone el dueño o el encargado. El cliente que da de alta el cajero arranca sin
    // fiado (límite 0) hasta que le pongan uno: ante la duda, no se fía.
    if (d.limite != null && s.rol === 'cajero')
      throw new ErrorPublico(403, 'sin_permiso', 'El límite lo pone el dueño o el encargado.');
    const limite = s.rol === 'cajero' ? 0 : (d.limite ?? null);
    const id = d.id ?? uuidv7();
    const fiscales = columnasFiscales(d);
    return req.db(async (tx) => {
      await exigirClientes(tx);
      const ya = await tx
        .selectFrom('clientes')
        .select(['id', 'limite'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (ya) return { id, limite: ya.limite };
      await documentoRepetido(tx, fiscales);
      await tx
        .insertInto('clientes')
        .values({
          id,
          kiosco_id: s.kioscoId,
          nombre: d.nombre,
          telefono: d.telefono ?? null,
          nota: d.nota ?? null,
          limite,
          ...fiscales,
        })
        .execute();
      // Sin datos personales en la auditoría: solo el ID.
      await auditar(tx, s, 'cliente.alta', { clienteId: id, limite }, req.ip);
      return { id, limite };
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
        documento: datosCliente.documento,
        condicionIva: datosCliente.condicionIva,
        domicilio: datosCliente.domicilio,
      }),
      req.body,
    );
    const comunes = {
      ...(d.nombre !== undefined ? { nombre: d.nombre } : {}),
      ...(d.telefono !== undefined ? { telefono: d.telefono } : {}),
      ...(d.nota !== undefined ? { nota: d.nota } : {}),
      ...(d.limite !== undefined ? { limite: d.limite } : {}),
      ...(d.activo !== undefined ? { activo: d.activo } : {}),
    };
    const fiscales = columnasFiscales(d);
    return req.db(async (tx) => {
      const c = await tx
        .selectFrom('clientes')
        .select(['id', 'limite'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      await documentoRepetido(tx, fiscales, id);
      await tx
        .updateTable('clientes')
        .set({ ...comunes, ...fiscales, updated_at: new Date() })
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
        .select([
          'id',
          'nombre',
          'telefono',
          'nota',
          'limite',
          'activo',
          'created_at',
          'doc_tipo',
          'doc_nro',
          'condicion_iva',
          'domicilio',
        ])
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
  app.post(
    '/api/v1/clientes/:id/pagos',
    { config: { roles: ['dueno', 'encargado', 'cajero'] } },
    async (req) => {
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
          // Dejar plata a favor (pagar de más) lo decide el dueño o el encargado.
          const debe = await saldoDe(tx, id);
          if (s.rol === 'cajero' && d.monto > Math.max(0, debe))
            throw new ErrorPublico(
              409,
              'pago_de_mas',
              `${c.nombre} debe ${formatearPlata(Math.max(0, debe))}: no se puede cobrar más que eso.`,
            );
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
          await auditar(
            tx,
            s,
            'cuenta.pago',
            { clienteId: id, monto: d.monto, medio: d.medio },
            req.ip,
          );
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
    },
  );
}
