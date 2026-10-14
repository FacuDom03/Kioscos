import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const CARPETA = fileURLToPath(new URL('../migrations/', import.meta.url));
// Número cualquiera pero fijo: evita que dos procesos migren a la vez.
const LOCK_ID = 72_617_301;

export interface ResultadoMigracion {
  aplicadas: string[];
}

/**
 * Aplica, en orden, las migraciones SQL que todavía no se aplicaron. Cada archivo corre en su
 * propia transacción. Se ejecuta con el usuario administrador, nunca con el rol de la API.
 */
export async function migrar(cliente: pg.Client | pg.PoolClient): Promise<ResultadoMigracion> {
  const archivos = (await readdir(CARPETA)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();

  await cliente.query('select pg_advisory_lock($1)', [LOCK_ID]);
  try {
    await cliente.query(`
      create table if not exists public.migraciones_aplicadas (
        nombre text primary key,
        aplicada_en timestamptz not null default now()
      )
    `);
    const { rows } = await cliente.query<{ nombre: string }>(
      'select nombre from public.migraciones_aplicadas',
    );
    const yaAplicadas = new Set(rows.map((r) => r.nombre));

    const aplicadas: string[] = [];
    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) continue;
      const sql = await readFile(CARPETA + archivo, 'utf8');
      await cliente.query('begin');
      try {
        await cliente.query(sql);
        await cliente.query('reset role');
        await cliente.query('insert into public.migraciones_aplicadas (nombre) values ($1)', [
          archivo,
        ]);
        await cliente.query('commit');
      } catch (error) {
        await cliente.query('rollback');
        throw new Error(`Falló la migración ${archivo}`, { cause: error });
      }
      aplicadas.push(archivo);
    }
    return { aplicadas };
  } finally {
    await cliente.query('select pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

/** Fija la contraseña de un rol con login de la app (mostrador_app o mostrador_panel). */
export async function fijarPasswordApp(
  cliente: pg.Client | pg.PoolClient,
  password: string,
  rol: 'mostrador_app' | 'mostrador_panel' = 'mostrador_app',
): Promise<void> {
  // ALTER ROLE no acepta parámetros: se escapa como literal con la función de la base.
  const { rows } = await cliente.query<{ literal: string }>('select quote_literal($1) as literal', [
    password,
  ]);
  const literal = rows[0]?.literal;
  if (!literal) throw new Error('No se pudo escapar la contraseña');
  await cliente.query(`alter role ${rol} password ${literal}`);
}
