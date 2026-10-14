import pg from 'pg';
import { variableRequerida } from './conexion.ts';
import { fijarPasswordApp, migrar } from './migrar.ts';

const cliente = new pg.Client({ connectionString: variableRequerida('DATABASE_ADMIN_URL') });
await cliente.connect();
try {
  const { aplicadas } = await migrar(cliente);
  console.log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'Base al día');
  const password = process.env['MOSTRADOR_APP_PASSWORD'];
  if (password) {
    await fijarPasswordApp(cliente, password);
    console.log('Contraseña de mostrador_app actualizada');
  }
  const passwordPanel = process.env['MOSTRADOR_PANEL_PASSWORD'];
  if (passwordPanel) {
    await fijarPasswordApp(cliente, passwordPanel, 'mostrador_panel');
    console.log('Contraseña de mostrador_panel actualizada');
  }
} finally {
  await cliente.end();
}
