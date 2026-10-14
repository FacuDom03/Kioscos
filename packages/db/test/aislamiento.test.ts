// Prueba obligatoria de aislamiento entre kioscos (sección 8 de docs/SPEC.md).
// Corre contra un PostgreSQL real, con el rol de la API (mostrador_app).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TABLAS_DE_KIOSCO, TABLAS_GLOBALES } from '../src/tipos.ts';
import { KIOSCO_A, KIOSCO_B } from '../src/semillas.ts';

type Tabla = (typeof TABLAS_DE_KIOSCO)[number];

let admin: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 2 });
  // Una sola conexión: obliga a que todas las pruebas reusen la misma y detecta fugas de
  // `app.kiosco_id` entre transacciones.
  app = new pg.Pool({ connectionString: inject('appUrl'), max: 1 });
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

/** Condición que identifica las filas de un kiosco en cada tabla (para el administrador). */
function filtroKiosco(tabla: Tabla): string {
  if (tabla === 'kioscos') return 'id = $1';
  if (tabla === 'usuarios') return 'id in (select usuario_id from membresias where kiosco_id = $1)';
  return 'kiosco_id = $1';
}

async function idsDe(tabla: Tabla, kiosco: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    `select id from ${tabla} where ${filtroKiosco(tabla)} order by id`,
    [kiosco],
  );
  return rows.map((r) => r.id);
}

async function huella(tabla: string): Promise<string> {
  const { rows } = await admin.query<{ h: string | null }>(
    `select md5(string_agg(t::text, '|' order by t.id)) as h from ${tabla} t`,
  );
  return rows[0]!.h ?? '';
}

/** Ejecuta `fn` en una transacción con el kiosco fijado, como hace withKiosco. */
async function comoKiosco<T>(
  kiosco: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('begin');
    if (kiosco) await c.query(`select set_config('app.kiosco_id', $1, true)`, [kiosco]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (error) {
    await c.query('rollback');
    throw error;
  } finally {
    c.release();
  }
}

/** Corre `fn` dentro de un savepoint y devuelve el código de error de Postgres (o null). */
async function codigoDeError(c: pg.PoolClient, sql: string, valores: unknown[] = []) {
  await c.query('savepoint intento');
  try {
    const r = await c.query(sql, valores);
    await c.query('release savepoint intento');
    return { codigo: null, filas: r.rowCount };
  } catch (error) {
    await c.query('rollback to savepoint intento');
    return { codigo: (error as { code?: string }).code ?? 'desconocido', filas: 0 };
  }
}

describe('estructura de la base', () => {
  it('toda tabla de public está clasificada como de kiosco o global', async () => {
    const { rows } = await admin.query<{ tabla: string }>(
      `select tablename as tabla from pg_tables
       where schemaname = 'public' and tablename <> 'migraciones_aplicadas' order by 1`,
    );
    const conocidas = new Set<string>([...TABLAS_DE_KIOSCO, ...TABLAS_GLOBALES]);
    expect(rows.map((r) => r.tabla).filter((t) => !conocidas.has(t))).toEqual([]);
    expect(rows).toHaveLength(conocidas.size);
  });

  it('toda tabla con kiosco_id es de kiosco', async () => {
    const { rows } = await admin.query<{ tabla: string }>(
      `select table_name as tabla from information_schema.columns
       where table_schema = 'public' and column_name = 'kiosco_id'`,
    );
    for (const { tabla } of rows) expect(TABLAS_DE_KIOSCO).toContain(tabla);
  });

  it.each(TABLAS_DE_KIOSCO)('%s tiene RLS habilitada y forzada, con política', async (tabla) => {
    const { rows } = await admin.query<{ rls: boolean; forzada: boolean; politicas: number }>(
      `select c.relrowsecurity as rls, c.relforcerowsecurity as forzada,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname) as politicas
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1`,
      [tabla],
    );
    expect(rows[0]).toEqual({ rls: true, forzada: true, politicas: expect.any(Number) });
    expect(rows[0]!.politicas).toBeGreaterThan(0);
  });

  it('el rol de la API no es superusuario, no saltea RLS y no es dueño de nada', async () => {
    const { rows } = await admin.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              pg_has_role('mostrador_app', 'mostrador_owner', 'member') as es_owner,
              (select count(*)::int from pg_class c where c.relowner = r.oid) as objetos_propios
       from pg_roles r where rolname = 'mostrador_app'`,
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      es_owner: false,
      objetos_propios: 0,
    });
  });

  it('las tablas son del rol dueño', async () => {
    const { rows } = await admin.query<{ tabla: string; dueno: string }>(
      `select tablename as tabla, tableowner as dueno from pg_tables
       where schemaname = 'public' and tablename <> 'migraciones_aplicadas'`,
    );
    for (const r of rows) expect(r.dueno, r.tabla).toBe('mostrador_owner');
  });

  it('el rol de la API no puede crear tablas', async () => {
    await expect(
      comoKiosco(null, (c) => c.query('create table intrusa (id int)')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('semillas', () => {
  it.each(TABLAS_DE_KIOSCO)('%s tiene filas de los dos kioscos', async (tabla) => {
    expect((await idsDe(tabla, KIOSCO_A)).length).toBeGreaterThan(0);
    expect((await idsDe(tabla, KIOSCO_B)).length).toBeGreaterThan(0);
  });
});

describe('lectura aislada', () => {
  it.each(TABLAS_DE_KIOSCO)('como A, %s devuelve solo filas de A', async (tabla) => {
    const deA = await idsDe(tabla, KIOSCO_A);
    const deB = new Set(await idsDe(tabla, KIOSCO_B));
    const vistos = await comoKiosco(KIOSCO_A, async (c) => {
      const { rows } = await c.query<{ id: string }>(`select id from ${tabla} order by id`);
      return rows.map((r) => r.id);
    });
    expect(vistos).toEqual(deA);
    expect(vistos.filter((id) => deB.has(id))).toEqual([]);
  });

  it.each(TABLAS_DE_KIOSCO)(
    'como A, %s no encuentra filas de B ni buscándolas por ID',
    async (tabla) => {
      const deB = await idsDe(tabla, KIOSCO_B);
      const n = await comoKiosco(KIOSCO_A, async (c) => {
        const { rows } = await c.query<{ n: number }>(
          `select count(*)::int as n from ${tabla} where id = any($1)`,
          [deB],
        );
        return rows[0]!.n;
      });
      expect(n).toBe(0);
    },
  );

  it.each(TABLAS_DE_KIOSCO)('sin kiosco fijado, %s no devuelve nada', async (tabla) => {
    const n = await comoKiosco(null, async (c) => {
      const { rows } = await c.query<{ n: number }>(`select count(*)::int as n from ${tabla}`);
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it('un kiosco_id mal formado hace fallar la consulta (falla cerrada)', async () => {
    await expect(
      comoKiosco('no-es-un-uuid', (c) => c.query('select count(*) from productos')),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('el kiosco fijado no pasa a la transacción siguiente en la misma conexión', async () => {
    await comoKiosco(KIOSCO_A, (c) => c.query('select 1'));
    const n = await comoKiosco(null, async (c) => {
      const { rows } = await c.query<{ n: number }>('select count(*)::int as n from productos');
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });
});

describe('escritura aislada', () => {
  it.each(TABLAS_DE_KIOSCO)(
    'como A, no se puede editar ni borrar filas de B en %s',
    async (tabla) => {
      const deB = await idsDe(tabla, KIOSCO_B);
      const antes = await huella(tabla);

      const { rows: columnas } = await admin.query<{ col: string }>(
        `select column_name as col from information_schema.column_privileges
       where grantee = 'mostrador_app' and table_schema = 'public' and table_name = $1
         and privilege_type = 'UPDATE' limit 1`,
        [tabla],
      );
      const { rows: borrar } = await admin.query<{ puede: boolean }>(
        `select has_table_privilege('mostrador_app', $1, 'DELETE') as puede`,
        [`public.${tabla}`],
      );

      await comoKiosco(KIOSCO_A, async (c) => {
        const col = columnas[0]?.col;
        if (col) {
          const r = await codigoDeError(
            c,
            `update ${tabla} set ${col} = ${col} where id = any($1)`,
            [deB],
          );
          expect(r).toEqual({ codigo: null, filas: 0 });
        }
        const r = await codigoDeError(c, `delete from ${tabla} where id = any($1)`, [deB]);
        expect(r).toEqual(
          borrar[0]!.puede ? { codigo: null, filas: 0 } : { codigo: '42501', filas: 0 },
        );
      });

      expect(await huella(tabla)).toBe(antes);
    },
  );

  it('como A, no se puede insertar una fila con el kiosco_id de B', async () => {
    const antes = await huella('categorias');
    await comoKiosco(KIOSCO_A, async (c) => {
      const r = await codigoDeError(
        c,
        `insert into categorias (id, kiosco_id, nombre) values (gen_random_uuid(), $1, 'Intrusa')`,
        [KIOSCO_B],
      );
      expect(r.codigo).toBe('42501'); // new row violates row-level security policy
    });
    expect(await huella('categorias')).toBe(antes);
  });

  it('como A, no se puede mover una fila propia al kiosco B', async () => {
    const [categoria] = await idsDe('categorias', KIOSCO_A);
    await comoKiosco(KIOSCO_A, async (c) => {
      // kiosco_id no se puede actualizar: ni siquiera hay permiso sobre la columna.
      const r = await codigoDeError(c, 'update categorias set kiosco_id = $1 where id = $2', [
        KIOSCO_B,
        categoria,
      ]);
      expect(r.codigo).toBe('42501');
    });
  });

  it('como A, no se puede apuntar a una fila de B por clave foránea', async () => {
    const [ventaB] = await idsDe('ventas', KIOSCO_B);
    const [productoB] = await idsDe('productos', KIOSCO_B);
    const antes = await Promise.all([huella('venta_items'), huella('codigos_barra')]);
    await comoKiosco(KIOSCO_A, async (c) => {
      const item = await codigoDeError(
        c,
        `insert into venta_items (id, kiosco_id, venta_id, descripcion, cantidad, precio_unitario, subtotal)
         values (gen_random_uuid(), $1, $2, 'Intruso', 1, 100, 100)`,
        [KIOSCO_A, ventaB],
      );
      expect(item.codigo).toBe('23503'); // foreign_key_violation
      const codigo = await codigoDeError(
        c,
        `insert into codigos_barra (id, kiosco_id, producto_id, codigo, tipo)
         values (gen_random_uuid(), $1, $2, '000111', 'interno')`,
        [KIOSCO_A, productoB],
      );
      expect(codigo.codigo).toBe('23503');
    });
    expect(await Promise.all([huella('venta_items'), huella('codigos_barra')])).toEqual(antes);
  });

  it('como A, no se puede registrar como autor a una persona de B', async () => {
    const [usuarioB] = await idsDe('usuarios', KIOSCO_B);
    await comoKiosco(KIOSCO_A, async (c) => {
      const r = await codigoDeError(
        c,
        `insert into compras (id, kiosco_id, usuario_id, total) values (gen_random_uuid(), $1, $2, 0)`,
        [KIOSCO_A, usuarioB],
      );
      expect(r.codigo).toBe('23503');
    });
  });
});

describe('tablas de solo agregar filas', () => {
  it.each(['auditoria', 'movimientos_stock', 'ventas', 'venta_items', 'pagos', 'gastos'] as const)(
    'en %s el rol de la API no puede borrar',
    async (tabla) => {
      await comoKiosco(KIOSCO_A, async (c) => {
        expect((await codigoDeError(c, `delete from ${tabla}`)).codigo).toBe('42501');
      });
    },
  );

  it.each([
    'auditoria',
    'movimientos_stock',
    'venta_items',
    'gastos',
    'compras',
    'compra_items',
  ] as const)('en %s el rol de la API no puede editar', async (tabla) => {
    await comoKiosco(KIOSCO_A, async (c) => {
      expect((await codigoDeError(c, `update ${tabla} set id = id`)).codigo).toBe('42501');
    });
  });
});
