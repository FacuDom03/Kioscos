// Datos guardados en el equipo (IndexedDB con Dexie). Solo lo necesario para vender: catálogo,
// turno abierto, ticket en curso y la bandeja de salida (sección 12 y regla 16).
import Dexie, { type EntityTable } from 'dexie';

export type TipoOp = 'apertura' | 'venta' | 'gasto';

export interface OpPendiente {
  id: string;
  kioscoId: string;
  tipo: TipoOp;
  datos: Record<string, unknown> & { id: string };
  creadaEn: string;
  estado: 'pendiente' | 'rechazada';
  mensaje?: string;
  intentos: number;
}

export interface Clave {
  clave: string;
  valor: unknown;
}

class BaseLocal extends Dexie {
  bandeja!: EntityTable<OpPendiente, 'id'>;
  claves!: EntityTable<Clave, 'clave'>;
  constructor() {
    super('mostrador');
    this.version(1).stores({ bandeja: 'id, kioscoId, estado, creadaEn', claves: 'clave' });
  }
}

export const local = new BaseLocal();

export async function leerClave<T>(clave: string): Promise<T | undefined> {
  try {
    return (await local.claves.get(clave))?.valor as T | undefined;
  } catch {
    return undefined;
  }
}

export async function guardarClave(clave: string, valor: unknown): Promise<void> {
  try {
    await local.claves.put({ clave, valor });
  } catch {
    // Sin IndexedDB (modo privado muy restringido): se sigue con lo que hay en memoria.
  }
}

export async function borrarClave(clave: string): Promise<void> {
  await local.claves.delete(clave).catch(() => undefined);
}

/** Al cerrar sesión: se borra todo lo del kiosco salvo la bandeja de salida. */
export async function borrarDatosDelKiosco(kioscoId: string): Promise<void> {
  const claves = await local.claves.toCollection().primaryKeys();
  await local.claves.bulkDelete(claves.filter((c) => c.endsWith(`:${kioscoId}`)));
}
