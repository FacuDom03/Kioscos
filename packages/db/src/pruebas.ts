// Utilidades para pruebas de integración: arma una base nueva, migrada y con semillas.
import pg from 'pg';
import { fijarPasswordApp, migrar } from './migrar.ts';
import { cargarSemillas } from './semillas.ts';

export interface BaseDePrueba {
  adminUrl: string;
  appUrl: string;
}

// Los roles son de todo el servidor: si en desarrollo la base de pruebas comparte servidor con la
// de trabajo, se usa la misma contraseña para no pisarla.
const PASSWORD_APP_PRUEBAS = process.env['MOSTRADOR_APP_PASSWORD'] ?? 'mostrador_app_pruebas';

/**
 * Crea (o recrea) la base `nombre`, la migra, carga las semillas y devuelve las URLs del
 * administrador y del rol de la API. Usa TEST_DATABASE_ADMIN_URL (una base cualquiera del
 * servidor, por ejemplo `postgres`) con un usuario que pueda crear bases y roles.
 */
export async function prepararBaseDePrueba(nombre: string): Promise<BaseDePrueba> {
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) throw new Error('Nombre de base inválido');
  const mantenimiento =
    process.env['TEST_DATABASE_ADMIN_URL'] ??
    'postgres://postgres:postgres@localhost:5432/postgres';

  const admin = new pg.Client({ connectionString: mantenimiento });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${nombre} with (force)`);
    await admin.query(`create database ${nombre}`);
  } finally {
    await admin.end();
  }

  const adminUrl = conBase(mantenimiento, nombre);
  const cliente = new pg.Client({ connectionString: adminUrl });
  await cliente.connect();
  try {
    await migrar(cliente);
    await fijarPasswordApp(cliente, PASSWORD_APP_PRUEBAS);
    await cargarSemillas(cliente);
  } finally {
    await cliente.end();
  }

  const app = new URL(adminUrl);
  app.username = 'mostrador_app';
  app.password = PASSWORD_APP_PRUEBAS;
  return { adminUrl, appUrl: app.toString() };
}

function conBase(url: string, base: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
}
