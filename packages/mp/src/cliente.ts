// Cliente mínimo de la API de Mercado Pago. Endpoints según la documentación oficial vigente
// (octubre de 2026): OAuth, sucursales y cajas, y Orders API para QR. Ver docs/decisiones/007.
import type { ConfigMp } from './config.ts';

export class ErrorMp extends Error {
  readonly status: number;
  readonly codigo: string | undefined;
  constructor(status: number, mensaje: string, codigo?: string) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number | string;
  scope?: string;
  live_mode?: boolean;
}

export interface Orden {
  id: string;
  status: 'created' | 'processed' | 'canceled' | 'refunded' | 'expired' | string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  user_id?: number | string;
  type_response?: { qr_data?: string };
  transactions?: { payments?: { id?: string; status?: string; amount?: string }[] };
}

type Fetch = typeof fetch;

export class ClienteMp {
  private readonly config: ConfigMp;
  private readonly fetch: Fetch;
  constructor(config: ConfigMp, f: Fetch = fetch) {
    this.config = config;
    this.fetch = f;
  }

  private async pedir<T>(
    metodo: string,
    ruta: string,
    opciones: {
      token?: string;
      cuerpo?: unknown;
      idempotencia?: string;
      formulario?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opciones.token) headers['authorization'] = `Bearer ${opciones.token}`;
    if (opciones.idempotencia) headers['x-idempotency-key'] = opciones.idempotencia;
    let body: string | undefined;
    if (opciones.formulario) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opciones.formulario).toString();
    } else if (opciones.cuerpo !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opciones.cuerpo);
    }
    const r = await this.fetch(`${this.config.apiBase}${ruta}`, {
      method: metodo,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await r.text();
    const datos = texto ? (JSON.parse(texto) as unknown) : {};
    if (!r.ok) {
      const d = datos as { message?: string; error?: string; errors?: { code?: string }[] };
      throw new ErrorMp(
        r.status,
        d.message ?? d.error ?? `Mercado Pago respondió ${r.status}`,
        d.errors?.[0]?.code ?? d.error,
      );
    }
    return datos as T;
  }

  urlAutorizacion(state: string, desafio: string): string {
    const u = new URL(this.config.authUrl);
    u.searchParams.set('client_id', this.config.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('platform_id', 'mp');
    u.searchParams.set('state', state);
    u.searchParams.set('redirect_uri', this.config.redirectUri);
    u.searchParams.set('code_challenge', desafio);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  intercambiarCodigo(code: string, verificador: string): Promise<Tokens> {
    return this.pedir('POST', '/oauth/token', {
      cuerpo: {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verificador,
        ...(this.config.pruebas ? { test_token: 'true' } : {}),
      },
    });
  }

  renovar(refreshToken: string): Promise<Tokens> {
    return this.pedir('POST', '/oauth/token', {
      cuerpo: {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });
  }

  yo(token: string): Promise<{ id: number | string }> {
    return this.pedir('GET', '/users/me', { token });
  }

  async buscarSucursal(
    token: string,
    userId: string,
    externalId: string,
  ): Promise<{ id: string } | null> {
    const r = await this.pedir<{ results?: { id: string | number }[] }>(
      'GET',
      `/users/${encodeURIComponent(userId)}/stores/search?external_id=${encodeURIComponent(externalId)}`,
      { token },
    ).catch(() => ({ results: [] }));
    const s = r.results?.[0];
    return s ? { id: String(s.id) } : null;
  }

  async crearSucursal(
    token: string,
    userId: string,
    datos: { nombre: string; externalId: string },
  ): Promise<{ id: string }> {
    const r = await this.pedir<{ id: string | number }>(
      'POST',
      `/users/${encodeURIComponent(userId)}/stores`,
      {
        token,
        cuerpo: {
          name: datos.nombre.slice(0, 60),
          external_id: datos.externalId,
          // La ubicación real la completa el dueño en Mercado Pago; acá va una genérica de Buenos Aires.
          location: {
            street_name: 'Sin calle',
            street_number: '0',
            city_name: 'Buenos Aires',
            state_name: 'Buenos Aires',
            latitude: -34.6037,
            longitude: -58.3816,
            reference: 'Cargado por Mostrador',
          },
        },
      },
    );
    return { id: String(r.id) };
  }

  async buscarCaja(token: string, externalId: string): Promise<{ id: string } | null> {
    const r = await this.pedir<{ results?: { id: string | number }[] }>(
      'GET',
      `/pos?external_id=${encodeURIComponent(externalId)}`,
      { token },
    ).catch(() => ({ results: [] }));
    const c = r.results?.[0];
    return c ? { id: String(c.id) } : null;
  }

  async crearCaja(
    token: string,
    datos: { nombre: string; storeId: string; externalId: string },
  ): Promise<{ id: string }> {
    const r = await this.pedir<{ id: string | number }>('POST', '/v2/pos', {
      token,
      idempotencia: `caja-${datos.externalId}`,
      cuerpo: {
        name: datos.nombre.slice(0, 45).replace(/[^\w\- ]/g, ''),
        store_id: datos.storeId,
        external_id: datos.externalId,
        config: { qr: { operating_mode: 'pdv' } },
      },
    });
    return { id: String(r.id) };
  }

  crearOrdenQr(
    token: string,
    datos: {
      idempotencia: string;
      externalReference: string;
      externalPosId: string;
      totalCentavos: number;
      descripcion: string;
      items: { titulo: string; precioCentavos: number; cantidad: number }[];
    },
  ): Promise<Orden> {
    const plata = (c: number) => (c / 100).toFixed(2);
    return this.pedir('POST', '/v1/orders', {
      token,
      idempotencia: datos.idempotencia,
      cuerpo: {
        type: 'qr',
        external_reference: datos.externalReference,
        description: datos.descripcion.slice(0, 150),
        expiration_time: 'PT10M',
        total_amount: plata(datos.totalCentavos),
        config: { qr: { external_pos_id: datos.externalPosId, mode: 'dynamic' } },
        transactions: { payments: [{ amount: plata(datos.totalCentavos) }] },
        // Items con cantidad entera (los productos por peso van como una unidad con su subtotal).
        items: datos.items
          .slice(0, 50)
          .map((i) =>
            Number.isInteger(i.cantidad)
              ? {
                  title: i.titulo.slice(0, 150),
                  unit_price: plata(i.precioCentavos),
                  quantity: i.cantidad,
                  unit_measure: 'unit',
                }
              : {
                  title: i.titulo.slice(0, 150),
                  unit_price: plata(Math.round(i.precioCentavos * i.cantidad)),
                  quantity: 1,
                  unit_measure: 'unit',
                },
          ),
      },
    });
  }

  obtenerOrden(token: string, id: string): Promise<Orden> {
    return this.pedir('GET', `/v1/orders/${encodeURIComponent(id)}`, { token });
  }

  cancelarOrden(token: string, id: string, idempotencia: string): Promise<Orden> {
    return this.pedir('POST', `/v1/orders/${encodeURIComponent(id)}/cancel`, {
      token,
      idempotencia,
    });
  }
}
