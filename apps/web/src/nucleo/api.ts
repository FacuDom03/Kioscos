// Cliente de la API: mismo origen, cookies HttpOnly, JSON. Los errores traen el mensaje del
// servidor, que ya está escrito para mostrarle a la persona.

export class ErrorApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly id: string | undefined;
  constructor(status: number, codigo: string, mensaje: string, id?: string) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.id = id;
  }
}

/** Se dispara cuando el servidor dice que la sesión venció, para volver a la pantalla de ingreso. */
export const eventosSesion = new EventTarget();

export async function api<T = unknown>(
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  cuerpo?: unknown,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'sin_conexion', 'No hay conexión. Revisá internet y probá de nuevo.');
  }
  const datos = (await r.json().catch(() => ({}))) as {
    error?: string;
    codigo?: string;
    id?: string;
  };
  if (!r.ok) {
    if (r.status === 401 && datos.codigo === 'sin_sesion')
      eventosSesion.dispatchEvent(new Event('vencida'));
    throw new ErrorApi(
      r.status,
      datos.codigo ?? 'error',
      datos.error ?? 'Algo salió mal. Probá de nuevo.',
      datos.id,
    );
  }
  return datos as T;
}

export const mensajeDeError = (e: unknown): string =>
  e instanceof ErrorApi
    ? e.message + (e.status >= 500 && e.id ? ` (código ${e.id.slice(0, 8)})` : '')
    : 'Algo salió mal. Probá de nuevo.';
