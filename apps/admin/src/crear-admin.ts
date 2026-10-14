// Crea una cuenta del panel admin. Uso (en el servidor, con el usuario administrador de la base):
//   DATABASE_ADMIN_URL=... MOSTRADOR_CLAVES_ARCHIVO=... node src/crear-admin.ts vos@ejemplo.com
// Pide la contraseña por la terminal y muestra el secreto TOTP para cargar en la app de códigos.
import {
  crearCifrador,
  hashPassword,
  leerClaves,
  nuevoSecretoTotp,
  urlOtpauth,
  base32,
} from '@mostrador/servidor';
import { uuidv7 } from '@mostrador/shared';
import pg from 'pg';
import { createInterface } from 'node:readline/promises';

const email = process.argv[2];
if (!email) throw new Error('Uso: node src/crear-admin.ts <email>');
const url = process.env['DATABASE_ADMIN_URL'];
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Contraseña (12 caracteres o más): ');
rl.close();
if (password.length < 12) throw new Error('La contraseña es muy corta');

const { claves, actual } = leerClaves();
const cifrador = await crearCifrador(claves, actual);
const secreto = nuevoSecretoTotp();
const { datos, version } = cifrador.cifrar(secreto);

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(
  `insert into admins (id, email, password_hash, totp_secreto_cifrado, totp_clave_version) values ($1, lower($2), $3, $4, $5)`,
  [uuidv7(), email, await hashPassword(password), datos, version],
);
await c.end();

console.log(
  '\nAdmin creado. Cargá este secreto en tu app de códigos (Google Authenticator, etc.):',
);
console.log(`  Secreto: ${base32(secreto)}`);
console.log(`  Enlace:  ${urlOtpauth(secreto, email, 'Mostrador Panel')}\n`);
