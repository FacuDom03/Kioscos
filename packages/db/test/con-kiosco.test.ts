import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { cerrarBaseApp, crearBaseApp, withKiosco, type BaseApp } from '../src/con-kiosco.ts';
import { KIOSCO_A, KIOSCO_B } from '../src/semillas.ts';

let base: BaseApp;

beforeAll(() => {
  // Una sola conexión en el pool: las dos transacciones la reusan.
  base = crearBaseApp(inject('appUrl'), 1);
});

afterAll(async () => {
  await cerrarBaseApp(base);
});

const nombresDeKiosco = (k: string) =>
  withKiosco(base, k, (tx) => tx.selectFrom('kioscos').select('nombre').execute());

describe('withKiosco', () => {
  it('cada transacción ve solo su kiosco, aunque reusen la conexión', async () => {
    expect(await nombresDeKiosco(KIOSCO_A)).toEqual([{ nombre: 'Kiosco Anita' }]);
    expect(await nombresDeKiosco(KIOSCO_B)).toEqual([{ nombre: 'Almacén Don Beto' }]);
  });

  it('el kiosco queda fijado solo dentro de la transacción', async () => {
    const valor = await withKiosco(base, KIOSCO_A, async (tx) => {
      const { rows } = await sql<{
        v: string;
      }>`select current_setting('app.kiosco_id', true) as v`.execute(tx);
      return rows[0]!.v;
    });
    expect(valor).toBe(KIOSCO_A);
  });

  it('si la función falla, se deshace todo', async () => {
    const id = '0192a000-0000-7000-8000-0000000000ff';
    await expect(
      withKiosco(base, KIOSCO_A, async (tx) => {
        await tx
          .insertInto('categorias')
          .values({ id, kiosco_id: KIOSCO_A, nombre: 'Temporal' })
          .execute();
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    const filas = await withKiosco(base, KIOSCO_A, (tx) =>
      tx.selectFrom('categorias').select('id').where('id', '=', id).execute(),
    );
    expect(filas).toEqual([]);
  });

  it('rechaza un kioscoId que no es UUID', async () => {
    await expect(withKiosco(base, "' or 1=1 --", async () => 1)).rejects.toThrow(TypeError);
  });

  it('la plata llega como number entero', async () => {
    const productos = await withKiosco(base, KIOSCO_A, (tx) =>
      tx.selectFrom('productos').select('precio').orderBy('precio').execute(),
    );
    expect(productos).toEqual([{ precio: 120000 }, { precio: 180000 }]);
  });
});
