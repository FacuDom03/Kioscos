import pg from 'pg';
import { variableRequerida } from './conexion.ts';
import { cargarSemillas } from './semillas.ts';

const cliente = new pg.Client({ connectionString: variableRequerida('DATABASE_ADMIN_URL') });
await cliente.connect();
try {
  console.log((await cargarSemillas(cliente)) ? 'Semillas cargadas' : 'Las semillas ya estaban');
} finally {
  await cliente.end();
}
