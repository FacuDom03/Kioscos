// Claves de API de los comercios (para n8n, Make, Zapier…). La clave entera se muestra una sola
// vez; en la base queda su hash. Ver docs/API.md.
import { sinKiosco, sql, type BaseApp } from '@mostrador/db';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';

export type PermisoApi = 'clientes';

export interface ClaveApi {
  id: string;
  kioscoId: string;
  permisos: PermisoApi[];
}

const FORMATO = /^Bearer (mst_[A-Za-z0-9_-]{43})$/;

/** Clave nueva: `mst_` y 32 bytes al azar. El prefijo sirve para reconocerla en la lista. */
export function nuevaClaveApi(): { clave: string; prefijo: string; hash: string } {
  const clave = `mst_${tokenAleatorio(32)}`;
  return { clave, prefijo: clave.slice(0, 10), hash: hashToken(clave) };
}

/** Lee el header `Authorization: Bearer mst_…`. Devuelve null si la clave no sirve. */
export async function leerClaveApi(
  base: BaseApp,
  autorizacion: string | undefined,
): Promise<ClaveApi | null> {
  const clave = autorizacion ? FORMATO.exec(autorizacion)?.[1] : undefined;
  if (!clave) return null;
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{
      clave_id: string;
      kiosco_id: string;
      permisos: PermisoApi[];
    }>`select * from auth_clave_api(${hashToken(clave)})`.execute(tx),
  );
  const r = rows[0];
  return r ? { id: r.clave_id, kioscoId: r.kiosco_id, permisos: r.permisos } : null;
}

/**
 * Límite de pedidos por clave (además del límite por IP de toda la API): ventana fija de un
 * minuto, en memoria. Alcanza con un solo proceso de API.
 */
export function crearLimitePorClave(maximo: number, ventanaMs = 60_000) {
  const cuentas = new Map<string, { desde: number; n: number }>();
  return (claveId: string, ahora = Date.now()): boolean => {
    const c = cuentas.get(claveId);
    if (!c || ahora - c.desde >= ventanaMs) {
      if (cuentas.size > 10_000) cuentas.clear();
      cuentas.set(claveId, { desde: ahora, n: 1 });
      return true;
    }
    c.n++;
    return c.n <= maximo;
  };
}
