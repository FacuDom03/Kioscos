// Prueba obligatoria de aislamiento por rutas: autenticado como el kiosco A, se recorren todas
// las rutas intentando leer, editar y borrar recursos del kiosco B. Nada de B puede verse ni
// cambiar.
import { TABLAS_DE_KIOSCO } from '@mostrador/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  crearEntorno,
  KIOSCO_A,
  KIOSCO_B,
  type Entorno,
  type Persona,
} from './ayuda.ts';
import { CASOS_AISLAMIENTO } from './casos-aislamiento.ts';

let e: Entorno;
let a: Persona;
const idsB = new Map<string, string[]>();

function filtroKiosco(tabla: string): string {
  if (tabla === 'kioscos') return 'id = $1';
  if (tabla === 'usuarios') return 'id in (select usuario_id from membresias where kiosco_id = $1)';
  if (tabla === 'passkeys')
    return 'usuario_id in (select usuario_id from membresias where kiosco_id = $1)';
  return 'kiosco_id = $1';
}

async function huellaDeB(): Promise<Record<string, string>> {
  const salida: Record<string, string> = {};
  for (const t of TABLAS_DE_KIOSCO) {
    const { rows } = await e.admin.query<{ h: string | null }>(
      `select md5(string_agg(t::text, '|' order by t.id)) as h from ${t} t where ${filtroKiosco(t)}`,
      [KIOSCO_B],
    );
    salida[t] = rows[0]?.h ?? '';
  }
  return salida;
}

function reemplazarB(valor: unknown): unknown {
  if (typeof valor === 'string') {
    const m = /^\$B:(\w+)$/.exec(valor);
    return m ? (idsB.get(m[1]!)?.[0] ?? valor) : valor;
  }
  if (Array.isArray(valor)) return valor.map(reemplazarB);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, reemplazarB(v)]));
  }
  return valor;
}

beforeAll(async () => {
  e = await crearEntorno();
  a = await altaConInvitacion(e.app, e.admin, KIOSCO_A);
  for (const t of [...TABLAS_DE_KIOSCO, 'passkeys']) {
    const { rows } = await e.admin.query<{ id: string }>(
      `select id from ${t} where ${filtroKiosco(t)}`,
      [KIOSCO_B],
    );
    idsB.set(
      t,
      rows.map((r) => r.id),
    );
  }
});

afterAll(async () => {
  await e.cerrar();
});

describe('aislamiento por rutas (A contra B)', () => {
  it('hay datos de B para probar', () => {
    expect(idsB.get('ventas')!.length).toBeGreaterThan(0);
  });

  const casosOrdenados = [...CASOS_AISLAMIENTO].sort(
    (x, y) => (x.metodo === 'DELETE' ? 1 : 0) - (y.metodo === 'DELETE' ? 1 : 0),
  );

  it.each(casosOrdenados)('$metodo $url → $espera', async (caso) => {
    if (caso.espera === 'propia') return;
    const antes = await huellaDeB();
    const todosLosIdsDeB = [...idsB.values()].flat();

    let url = caso.url;
    if (url.includes(':id')) {
      const id =
        (caso.tabla && idsB.get(caso.tabla)?.[0]) ?? '0192a000-0000-7000-8000-0000000000ee';
      url = url.replace(':id', id);
    }
    const cuerpo = caso.metodo === 'GET' ? undefined : (reemplazarB(caso.cuerpo) ?? {});
    const r = await a.cliente.pedir(caso.metodo, url, cuerpo);

    if (caso.espera === 'no_encontrado') {
      expect(r.statusCode, r.body).toBe(404);
    }
    if (caso.espera === 'sin_datos_de_b') {
      expect(r.statusCode, r.body).toBe(200);
    }
    // En ningún caso la respuesta trae IDs de B.
    for (const id of todosLosIdsDeB) expect(r.body).not.toContain(id);
    expect(await huellaDeB()).toEqual(antes);
  });
});
