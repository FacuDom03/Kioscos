export { crearBaseApp, cerrarBaseApp, withKiosco, sinKiosco, pingBase } from './con-kiosco.ts';
export type { BaseApp, TxKiosco } from './con-kiosco.ts';
export { TABLAS_DE_KIOSCO, TABLAS_GLOBALES, TABLAS_SISTEMA } from './tipos.ts';
export type { Database, EventoAviso, Rol } from './tipos.ts';
export { sql } from 'kysely';
export type { RawBuilder } from 'kysely';
export { moverStock, type TipoMovimiento } from './stock.ts';
