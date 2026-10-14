// Servidor falso de Mercado Pago para las pruebas. Imita los endpoints que usa la API, con
// verificación de PKCE y órdenes que solo puede ver el vendedor dueño del token.
import { desafioS256 } from '@mostrador/mp';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';

interface OrdenFalsa {
  id: string;
  status: string;
  status_detail: string;
  external_reference: string;
  total_amount: string;
  user_id: number;
  external_pos_id: string;
  type_response: { qr_data: string };
  transactions: { payments: { id: string; status: string; amount: string }[] };
}

export class MpFalso {
  servidor!: FastifyInstance;
  url = '';
  private codigos = new Map<string, { userId: number; desafio: string }>();
  private tokens = new Map<string, number>();
  private refresh = new Map<string, number>();
  ordenes = new Map<string, OrdenFalsa>();
  private idempotencia = new Map<string, string>();
  private cajas = new Map<string, { id: string; userId: number }>();
  private sucursales = new Map<string, { id: string; userId: number }>();
  /** Si es true, crear órdenes falla (para probar el error del QR). */
  fallarOrdenes = false;
  pedidosOrden: { idempotencia: string | undefined; cuerpo: Record<string, unknown> }[] = [];
  private readonly puerto: number;
  constructor(puerto = 0) {
    this.puerto = puerto;
  }

  async iniciar(): Promise<this> {
    const s = Fastify();
    const usuarioDe = (auth: string | undefined) =>
      this.tokens.get((auth ?? '').replace('Bearer ', ''));

    s.post('/oauth/token', async (req, reply) => {
      const b = req.body as Record<string, string>;
      if (b['client_secret'] !== 'secreto-app')
        return reply.code(401).send({ error: 'invalid_client' });
      let userId: number | undefined;
      if (b['grant_type'] === 'authorization_code') {
        const c = this.codigos.get(b['code'] ?? '');
        if (!c || desafioS256(b['code_verifier'] ?? '') !== c.desafio)
          return reply.code(400).send({ error: 'invalid_grant' });
        this.codigos.delete(b['code'] ?? '');
        userId = c.userId;
      } else if (b['grant_type'] === 'refresh_token') {
        userId = this.refresh.get(b['refresh_token'] ?? '');
        if (!userId) return reply.code(400).send({ error: 'invalid_grant' });
      }
      if (!userId) return reply.code(400).send({ error: 'unsupported_grant_type' });
      const access = `APP_USR-${userId}-${randomBytes(8).toString('hex')}`;
      const ref = `TG-${randomBytes(8).toString('hex')}`;
      this.tokens.set(access, userId);
      this.refresh.set(ref, userId);
      return {
        access_token: access,
        refresh_token: ref,
        expires_in: 15_552_000,
        user_id: userId,
        token_type: 'bearer',
        scope: 'offline_access read write',
      };
    });

    s.get('/users/me', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      return u ? { id: u } : reply.code(401).send({ message: 'invalid token' });
    });
    s.get('/users/:id/stores/search', async (req) => {
      const ext = (req.query as Record<string, string>)['external_id'] ?? '';
      const st = this.sucursales.get(ext);
      return { results: st ? [{ id: st.id }] : [] };
    });
    s.post('/users/:id/stores', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      if (!u) return reply.code(401).send({});
      const b = req.body as { external_id: string };
      const st = { id: String(Math.floor(Math.random() * 1e8)), userId: u };
      this.sucursales.set(b.external_id, st);
      return { id: st.id };
    });
    s.get('/pos', async (req) => {
      const ext = (req.query as Record<string, string>)['external_id'] ?? '';
      const c = this.cajas.get(ext);
      return { results: c ? [{ id: c.id }] : [] };
    });
    s.post('/v2/pos', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      if (!u) return reply.code(401).send({});
      const b = req.body as { external_id: string };
      const c = { id: String(Math.floor(Math.random() * 1e8)), userId: u };
      this.cajas.set(b.external_id, c);
      return { id: c.id };
    });

    s.post('/v1/orders', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      if (!u) return reply.code(401).send({});
      const clave = req.headers['x-idempotency-key'] as string | undefined;
      this.pedidosOrden.push({ idempotencia: clave, cuerpo: req.body as Record<string, unknown> });
      if (this.fallarOrdenes) return reply.code(500).send({ message: 'internal' });
      if (clave && this.idempotencia.has(clave))
        return this.ordenes.get(this.idempotencia.get(clave) ?? '');
      const b = req.body as {
        external_reference: string;
        total_amount: string;
        config: { qr: { external_pos_id: string } };
      };
      const id = `ORD${randomBytes(12).toString('hex').toUpperCase()}`;
      const o: OrdenFalsa = {
        id,
        status: 'created',
        status_detail: 'created',
        external_reference: b.external_reference,
        total_amount: b.total_amount,
        user_id: u,
        external_pos_id: b.config.qr.external_pos_id,
        type_response: {
          qr_data: `00020101021243650016COM.MERCADOLIBRE0201306${id}5204970053030325802AR6304ABCD`,
        },
        transactions: {
          payments: [{ id: `PAY${id.slice(3, 15)}`, status: 'created', amount: b.total_amount }],
        },
      };
      this.ordenes.set(id, o);
      if (clave) this.idempotencia.set(clave, id);
      return o;
    });
    s.get('/v1/orders/:id', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      const o = this.ordenes.get((req.params as { id: string }).id);
      if (!u || !o || o.user_id !== u) return reply.code(404).send({ message: 'not found' });
      return o;
    });
    s.post('/v1/orders/:id/cancel', async (req, reply) => {
      const u = usuarioDe(req.headers.authorization);
      const o = this.ordenes.get((req.params as { id: string }).id);
      if (!u || !o || o.user_id !== u) return reply.code(404).send({});
      if (o.status !== 'created')
        return reply.code(409).send({ message: 'order_already_processed' });
      o.status = 'canceled';
      o.status_detail = 'canceled';
      return o;
    });

    // Pantalla de autorización: el vendedor "acepta" y vuelve a la app con el code.
    s.get('/authorization', async (req, reply) => {
      const q = req.query as Record<string, string>;
      const code = this.autorizar(Number(q['usuario'] ?? 777), q['code_challenge'] ?? '');
      const destino = new URL(q['redirect_uri'] ?? '');
      destino.searchParams.set('code', code);
      destino.searchParams.set('state', q['state'] ?? '');
      return reply.redirect(destino.toString());
    });
    // Solo pruebas: simular que el cliente pagó la orden de una venta.
    s.post('/__pruebas/pagar', async (req, reply) => {
      const caja = (req.query as Record<string, string>)['caja'];
      const o = [...this.ordenes.values()]
        .reverse()
        .find((x) => x.status === 'created' && (!caja || x.external_pos_id === caja));
      if (!o) return reply.code(404).send({});
      this.pagar(o.id);
      return { ok: true, id: o.id };
    });

    await s.listen({ host: '127.0.0.1', port: this.puerto });
    const dir = s.server.address();
    this.url = typeof dir === 'object' && dir ? `http://127.0.0.1:${dir.port}` : '';
    void this.puerto;
    this.servidor = s;
    return this;
  }

  /** Simula que el vendedor autoriza la app en Mercado Pago: devuelve el code del redirect. */
  autorizar(userId: number, desafio: string): string {
    const code = `TG-code-${randomBytes(6).toString('hex')}`;
    this.codigos.set(code, { userId, desafio });
    return code;
  }

  pagar(ordenId: string): void {
    const o = this.ordenes.get(ordenId);
    if (!o) throw new Error('orden inexistente');
    o.status = 'processed';
    o.status_detail = 'accredited';
    o.transactions.payments[0]!.status = 'processed';
  }

  vencer(ordenId: string): void {
    const o = this.ordenes.get(ordenId);
    if (o) {
      o.status = 'expired';
      o.status_detail = 'expired';
    }
  }

  cerrar(): Promise<void> {
    return this.servidor.close();
  }
}
