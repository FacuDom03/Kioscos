// Ingreso: email + contraseña + segundo factor (passkey o TOTP), invitaciones y PIN de cajero.
// Sección 9 de docs/SPEC.md.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withKiosco } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { credencialesInvalidas, datosInvalidos, ErrorPublico, noEncontrado } from '../errores.ts';
import { hashPassword, verificarPassword } from '@mostrador/servidor';
import { hashToken } from '@mostrador/servidor';
import {
  normalizarCodigoRecuperacion,
  nuevosCodigosRecuperacion,
  nuevoSecretoTotp,
  urlOtpauth,
  verificarTotp,
  base32,
} from '@mostrador/servidor';
import { auditar } from '../servicios/auditoria.ts';
import {
  aceptarInvitacion,
  activarSegundoFactor,
  actualizarContadorPasskey,
  buscarInvitacion,
  credencialesPorEmail,
  dispositivoPorCredencial,
  guardarPasskey,
  guardarTotp,
  leerTotp,
  passkeysDe,
  registrarIntento,
  usarCodigoRecuperacion,
} from '../servicios/cuentas.ts';
import {
  borrarSesion,
  completarSesion,
  crearSesion,
  guardarDesafio,
  leerSesion,
  membresiasDe,
  type Sesion,
} from '../servicios/sesiones.ts';
import { borrarCookieSesion, ponerCookieSesion } from '../sesion.ts';
import { validar } from '../validar.ts';
import { leerCookieEquipo } from './dispositivos.ts';

const ESTRICTO = { rateLimit: { max: 10, timeWindow: '1 minute' } } as const;

const password = z.string().min(10, 'muy corta').max(128);
const email = z.email().max(254);

const sinCuerpo = z.strictObject({}).optional();

const bloqueado = () =>
  new ErrorPublico(429, 'bloqueado', 'Demasiados intentos. Esperá unos minutos y probá de nuevo.');

function sesionPendiente(req: FastifyRequest): Sesion {
  const s = req.sesion;
  if (!s || s.tipo !== 'pendiente_2fa') throw credencialesInvalidas();
  return s;
}

/** Sesión pendiente (configurando el segundo factor) o completa (agregando uno más). */
function sesionParaConfigurar(req: FastifyRequest): Sesion {
  const s = req.sesion;
  if (!s || s.esSoporte) throw credencialesInvalidas();
  if (s.tipo === 'completa' && (s.rol === 'cajero' || !s.rol)) throw credencialesInvalidas();
  return s;
}

async function estadoDeSesion(app: FastifyInstance, s: Sesion) {
  if (s.tipo === 'pendiente_2fa') {
    const totp = await leerTotp(app.base, s.usuarioId);
    const passkeys = await passkeysDe(app.base, s.usuarioId);
    const activo = totp?.segundo_factor_activo === true;
    return {
      tipo: s.tipo,
      paso: activo ? 'segundo_factor' : 'configurar_segundo_factor',
      metodos: { totp: activo && !!totp?.totp_secreto_cifrado, passkey: passkeys.length > 0 },
    };
  }
  const kiosco = s.kioscoId
    ? await withKiosco(app.base, s.kioscoId, (tx) =>
        tx
          .selectFrom('kioscos')
          .select(['id', 'nombre', 'plan', 'rubro', 'modulos', 'configurado'])
          .executeTakeFirst(),
      )
    : null;
  const kioscos = s.esSoporte
    ? []
    : (await membresiasDe(app.base, s.usuarioId))
        .filter((m) => m.rol !== 'cajero' || s.rol === 'cajero')
        .map((m) => ({ id: m.kiosco_id, nombre: m.nombre, rol: m.rol }));
  return {
    tipo: s.tipo,
    usuario: { id: s.usuarioId, nombre: s.nombre },
    rol: s.rol,
    kiosco: kiosco ?? null,
    kioscos,
    esSoporte: s.esSoporte,
    enDispositivo: !!s.dispositivoId,
  };
}

/** Termina el segundo factor: pasa a sesión completa en el primer kiosco donde es dueño o encargado. */
async function completar(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  s: Sesion,
) {
  const membresias = (await membresiasDe(app.base, s.usuarioId)).filter((m) => m.rol !== 'cajero');
  const elegida = membresias.find((m) => m.rol === 'dueno') ?? membresias[0];
  if (!elegida) throw credencialesInvalidas();
  const token = await completarSesion(app.base, s.tokenHash, elegida.kiosco_id, elegida.rol);
  ponerCookieSesion(app, reply, token);
  await withKiosco(app.base, elegida.kiosco_id, (tx) =>
    auditar(
      tx,
      { usuarioId: s.usuarioId, kioscoId: elegida.kiosco_id, esSoporte: false },
      'sesion.inicio',
      {},
      req.ip,
    ),
  );
  const nueva = { ...s, tipo: 'completa' as const, kioscoId: elegida.kiosco_id, rol: elegida.rol };
  return estadoDeSesion(app, nueva);
}

async function nuevosCodigos(app: FastifyInstance, usuarioId: string): Promise<string[]> {
  const codigos = nuevosCodigosRecuperacion();
  await activarSegundoFactor(
    app.base,
    usuarioId,
    codigos.map((c) => hashToken(normalizarCodigoRecuperacion(c))),
  );
  return codigos;
}

export async function rutasAuth(app: FastifyInstance): Promise<void> {
  const { config } = app;

  // ---------------------------------------------------------------- login
  app.post('/api/v1/auth/login', { config: { publica: true, ...ESTRICTO } }, async (req, reply) => {
    const datos = validar(
      z.strictObject({ email, password: z.string().min(1).max(128) }),
      req.body,
    );
    const cred = await credencialesPorEmail(app.base, datos.email);
    if (!cred) {
      await verificarPassword(null, datos.password);
      throw credencialesInvalidas();
    }
    if (cred.bloqueado_hasta && cred.bloqueado_hasta > new Date()) throw bloqueado();
    const ok = await verificarPassword(cred.password_hash, datos.password);
    await registrarIntento(app.base, cred.usuario_id, ok);
    if (!ok) throw credencialesInvalidas();

    const membresias = (await membresiasDe(app.base, cred.usuario_id)).filter(
      (m) => m.rol !== 'cajero',
    );
    if (membresias.length === 0) throw credencialesInvalidas();

    if (req.sesion) await borrarSesion(app.base, req.sesion.tokenHash);
    const token = await crearSesion(app.base, {
      usuarioId: cred.usuario_id,
      kioscoId: null,
      rol: null,
      tipo: 'pendiente_2fa',
    });
    ponerCookieSesion(app, reply, token);
    return {
      tipo: 'pendiente_2fa',
      paso: cred.segundo_factor_activo ? 'segundo_factor' : 'configurar_segundo_factor',
      metodos: {
        totp: cred.segundo_factor_activo && !!cred.totp_secreto_cifrado,
        passkey: cred.tiene_passkey,
      },
    };
  });

  app.get('/api/v1/auth/yo', { config: { pendiente: true } }, async (req) => {
    if (!req.sesion) throw credencialesInvalidas();
    return estadoDeSesion(app, req.sesion);
  });

  app.post('/api/v1/auth/salir', { config: { publica: true } }, async (req, reply) => {
    validar(sinCuerpo, req.body);
    if (req.sesion) await borrarSesion(app.base, req.sesion.tokenHash);
    borrarCookieSesion(app, reply);
    return { ok: true };
  });

  app.post(
    '/api/v1/auth/kiosco',
    { config: { roles: ['dueno', 'encargado'] } },
    async (req, reply) => {
      const { kioscoId } = validar(z.strictObject({ kioscoId: z.uuid() }), req.body);
      const m = (await membresiasDe(app.base, req.completa.usuarioId)).find(
        (x) => x.kiosco_id === kioscoId && x.rol !== 'cajero',
      );
      if (!m) throw noEncontrado();
      const token = await completarSesion(app.base, req.completa.tokenHash, m.kiosco_id, m.rol);
      ponerCookieSesion(app, reply, token);
      return estadoDeSesion(app, { ...req.completa, kioscoId: m.kiosco_id, rol: m.rol });
    },
  );

  // ---------------------------------------------------------------- segundo factor
  app.post(
    '/api/v1/auth/totp',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req, reply) => {
      const s = sesionPendiente(req);
      const { codigo } = validar(z.strictObject({ codigo: z.string().max(10) }), req.body);
      const t = await leerTotp(app.base, s.usuarioId);
      if (!t?.segundo_factor_activo || !t.totp_secreto_cifrado || t.totp_clave_version == null) {
        throw credencialesInvalidas();
      }
      const secreto = app.cifrador.descifrar(t.totp_secreto_cifrado, t.totp_clave_version);
      const ok = verificarTotp(secreto, codigo.replace(/\s/g, ''));
      await registrarIntento(app.base, s.usuarioId, ok);
      if (!ok) throw credencialesInvalidas();
      return completar(app, req, reply, s);
    },
  );

  app.post(
    '/api/v1/auth/recuperacion',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req, reply) => {
      const s = sesionPendiente(req);
      const { codigo } = validar(z.strictObject({ codigo: z.string().max(20) }), req.body);
      const ok = await usarCodigoRecuperacion(
        app.base,
        s.usuarioId,
        hashToken(normalizarCodigoRecuperacion(codigo)),
      );
      await registrarIntento(app.base, s.usuarioId, ok);
      if (!ok) throw credencialesInvalidas();
      return completar(app, req, reply, s);
    },
  );

  app.post(
    '/api/v1/auth/passkey/opciones',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req) => {
      const s = sesionPendiente(req);
      validar(sinCuerpo, req.body);
      const passkeys = await passkeysDe(app.base, s.usuarioId);
      if (passkeys.length === 0) throw credencialesInvalidas();
      const opciones = await generateAuthenticationOptions({
        rpID: config.rpId,
        allowCredentials: passkeys.map((p) => ({ id: p.credential_id, transports: p.transportes })),
        userVerification: 'preferred',
      });
      await guardarDesafio(app.base, s.tokenHash, opciones.challenge);
      return opciones;
    },
  );

  app.post(
    '/api/v1/auth/passkey/verificar',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req, reply) => {
      const s = sesionPendiente(req);
      const { respuesta } = validar(
        z.strictObject({ respuesta: z.looseObject({ id: z.string().max(1024) }) }),
        req.body,
      );
      const passkey = (await passkeysDe(app.base, s.usuarioId)).find(
        (p) => p.credential_id === respuesta.id,
      );
      if (!passkey || !s.desafio) throw credencialesInvalidas();
      const desafio = s.desafio;
      await guardarDesafio(app.base, s.tokenHash, null);
      const r = await verifyAuthenticationResponse({
        response: respuesta as unknown as AuthenticationResponseJSON,
        expectedChallenge: desafio,
        expectedOrigin: config.origen,
        expectedRPID: config.rpId,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.clave_publica),
          counter: passkey.contador,
          transports: passkey.transportes,
        },
      }).catch(() => null);
      await registrarIntento(app.base, s.usuarioId, !!r?.verified);
      if (!r?.verified) throw credencialesInvalidas();
      await actualizarContadorPasskey(
        app.base,
        s.usuarioId,
        passkey.credential_id,
        r.authenticationInfo.newCounter,
      );
      return completar(app, req, reply, s);
    },
  );

  // ---------------------------------------------------------------- configurar segundo factor
  app.post(
    '/api/v1/auth/configurar/totp',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req) => {
      const s = sesionParaConfigurar(req);
      validar(sinCuerpo, req.body);
      const secreto = nuevoSecretoTotp();
      const { datos, version } = app.cifrador.cifrar(secreto);
      // El secreto nuevo queda en la sesión hasta que se confirme con un código.
      await guardarDesafio(app.base, s.tokenHash, `totp:${version}:${datos.toString('base64')}`);
      return {
        secreto: base32(secreto),
        otpauth: urlOtpauth(secreto, s.email ?? s.nombre, config.rpNombre),
      };
    },
  );

  app.post(
    '/api/v1/auth/configurar/totp/confirmar',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req, reply) => {
      const s = sesionParaConfigurar(req);
      const { codigo } = validar(z.strictObject({ codigo: z.string().max(10) }), req.body);
      const m = /^totp:(\d+):(.+)$/.exec(s.desafio ?? '');
      if (!m) throw datosInvalidos('Volvé a generar el código QR.');
      const version = Number(m[1]);
      const cifrado = Buffer.from(m[2] ?? '', 'base64');
      const secreto = app.cifrador.descifrar(cifrado, version);
      if (!verificarTotp(secreto, codigo.replace(/\s/g, ''))) {
        throw new ErrorPublico(
          400,
          'codigo',
          'El código no coincide. Revisá la hora del celular y probá de nuevo.',
        );
      }
      await guardarTotp(app.base, s.usuarioId, cifrado, version);
      await guardarDesafio(app.base, s.tokenHash, null);
      return terminarConfiguracion(app, req, reply, s);
    },
  );

  app.post(
    '/api/v1/auth/configurar/passkey/opciones',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req) => {
      const s = sesionParaConfigurar(req);
      validar(sinCuerpo, req.body);
      const existentes = await passkeysDe(app.base, s.usuarioId);
      const cuenta = s.email ?? s.nombre;
      const opciones = await generateRegistrationOptions({
        rpName: config.rpNombre,
        rpID: config.rpId,
        userName: cuenta || 'Mostrador',
        userDisplayName: s.nombre || cuenta || 'Mostrador',
        userID: new Uint8Array(Buffer.from(s.usuarioId.replace(/-/g, ''), 'hex')),
        attestationType: 'none',
        excludeCredentials: existentes.map((p) => ({
          id: p.credential_id,
          transports: p.transportes,
        })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      });
      await guardarDesafio(app.base, s.tokenHash, `registro:${opciones.challenge}`);
      return opciones;
    },
  );

  app.post(
    '/api/v1/auth/configurar/passkey/verificar',
    { config: { pendiente: true, ...ESTRICTO } },
    async (req, reply) => {
      const s = sesionParaConfigurar(req);
      const { respuesta, nombre } = validar(
        z.strictObject({
          respuesta: z.looseObject({ id: z.string().max(1024) }),
          nombre: z.string().max(60).optional(),
        }),
        req.body,
      );
      const desafio = /^registro:(.+)$/.exec(s.desafio ?? '')?.[1];
      if (!desafio) throw datosInvalidos('Volvé a intentar agregar la passkey.');
      await guardarDesafio(app.base, s.tokenHash, null);
      const r = await verifyRegistrationResponse({
        response: respuesta as unknown as RegistrationResponseJSON,
        expectedChallenge: desafio,
        expectedOrigin: config.origen,
        expectedRPID: config.rpId,
      }).catch(() => null);
      if (!r?.verified) throw datosInvalidos('No se pudo registrar la passkey. Probá de nuevo.');
      const c = r.registrationInfo.credential;
      await guardarPasskey(app.base, {
        id: uuidv7(),
        usuarioId: s.usuarioId,
        credentialId: c.id,
        clave: Buffer.from(c.publicKey),
        contador: c.counter,
        transportes: c.transports ?? [],
        nombre: nombre?.trim() || 'Passkey',
      });
      return terminarConfiguracion(app, req, reply, s);
    },
  );

  // ---------------------------------------------------------------- invitaciones
  app.get(
    '/api/v1/auth/invitaciones/:token',
    { config: { publica: true, ...ESTRICTO } },
    async (req) => {
      const { token } = validar(z.strictObject({ token: z.string().min(20).max(100) }), req.params);
      const inv = await buscarInvitacion(app.base, hashToken(token));
      if (!inv) throw invitacionVencida();
      return {
        kiosco: inv.kiosco_nombre,
        email: inv.email,
        rol: inv.rol,
        usuarioExiste: inv.usuario_existe,
      };
    },
  );

  app.post(
    '/api/v1/auth/invitaciones/:token',
    { config: { publica: true, ...ESTRICTO } },
    async (req, reply) => {
      const { token } = validar(z.strictObject({ token: z.string().min(20).max(100) }), req.params);
      const datos = validar(
        z.strictObject({ nombre: z.string().trim().min(1).max(60), password }),
        req.body,
      );
      const tokenHash = hashToken(token);
      const inv = await buscarInvitacion(app.base, tokenHash);
      if (!inv) throw invitacionVencida();

      let passwordHash: string | null = null;
      if (inv.usuario_existe) {
        const cred = await credencialesPorEmail(app.base, inv.email);
        if (!cred || !(await verificarPassword(cred.password_hash, datos.password))) {
          throw new ErrorPublico(
            401,
            'credenciales',
            'Ya tenés una cuenta con este email: poné tu contraseña de siempre.',
          );
        }
      } else {
        passwordHash = await hashPassword(datos.password);
      }
      const usuarioId = await aceptarInvitacion(app.base, {
        tokenHash,
        usuarioNuevo: uuidv7(),
        membresia: uuidv7(),
        nombre: datos.nombre,
        passwordHash,
      });
      if (req.sesion) await borrarSesion(app.base, req.sesion.tokenHash);
      const nuevo = await crearSesion(app.base, {
        usuarioId,
        kioscoId: null,
        rol: null,
        tipo: 'pendiente_2fa',
      });
      ponerCookieSesion(app, reply, nuevo);
      const t = await leerTotp(app.base, usuarioId);
      return {
        tipo: 'pendiente_2fa',
        paso: t?.segundo_factor_activo ? 'segundo_factor' : 'configurar_segundo_factor',
      };
    },
  );

  // ---------------------------------------------------------------- soporte
  // El panel crea la sesión de soporte (solo si el dueño activó el acceso) y entrega el token
  // por un enlace. Acá el navegador lo cambia por la cookie de sesión.
  app.post(
    '/api/v1/auth/soporte',
    { config: { publica: true, ...ESTRICTO } },
    async (req, reply) => {
      const { token } = validar(z.strictObject({ token: z.string().min(20).max(100) }), req.body);
      const s = await leerSesion(app.base, token);
      if (!s?.esSoporte) throw credencialesInvalidas();
      ponerCookieSesion(app, reply, token);
      return estadoDeSesion(app, s);
    },
  );

  // ---------------------------------------------------------------- PIN de cajero
  app.get('/api/v1/auth/pin/personas', { config: { publica: true } }, async (req) => {
    const equipo = leerCookieEquipo(app, req);
    const disp = equipo ? await dispositivoPorCredencial(app.base, hashToken(equipo)) : null;
    if (!disp) return { dispositivo: null, personas: [] };
    return withKiosco(app.base, disp.kiosco_id, async (tx) => {
      const kiosco = await tx.selectFrom('kioscos').select('nombre').executeTakeFirst();
      const personas = await tx
        .selectFrom('membresias as m')
        .innerJoin('usuarios as u', 'u.id', 'm.usuario_id')
        .innerJoin('pines as p', (j) =>
          j.onRef('p.membresia_id', '=', 'm.id').onRef('p.kiosco_id', '=', 'm.kiosco_id'),
        )
        .select(['m.id as id', 'u.nombre as nombre'])
        .where('m.rol', '=', 'cajero')
        .where('m.activa', '=', true)
        .orderBy('u.nombre')
        .execute();
      return { dispositivo: { nombre: disp.nombre, kiosco: kiosco?.nombre ?? '' }, personas };
    });
  });

  app.post('/api/v1/auth/pin', { config: { publica: true, ...ESTRICTO } }, async (req, reply) => {
    const datos = validar(
      z.strictObject({ membresiaId: z.uuid(), pin: z.string().regex(/^\d{4,6}$/) }),
      req.body,
    );
    const equipo = leerCookieEquipo(app, req);
    const disp = equipo ? await dispositivoPorCredencial(app.base, hashToken(equipo)) : null;
    // El PIN solo funciona en un dispositivo registrado.
    if (!disp)
      throw new ErrorPublico(
        401,
        'equipo',
        'Este equipo no está autorizado. Pedile al dueño que lo autorice.',
      );

    const usuarioId = await withKiosco(app.base, disp.kiosco_id, async (tx) => {
      const fila = await tx
        .selectFrom('pines as p')
        .innerJoin('membresias as m', (j) =>
          j.onRef('m.id', '=', 'p.membresia_id').onRef('m.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select([
          'p.id',
          'p.pin_hash',
          'p.intentos_fallidos',
          'p.bloqueado_hasta',
          'm.usuario_id',
          'm.rol',
          'm.activa',
        ])
        .where('p.membresia_id', '=', datos.membresiaId)
        .executeTakeFirst();
      if (!fila || fila.rol !== 'cajero' || !fila.activa) {
        await verificarPassword(null, datos.pin);
        return { error: credencialesInvalidas() };
      }
      if (fila.bloqueado_hasta && fila.bloqueado_hasta > new Date()) return { error: bloqueado() };
      const ok = await verificarPassword(fila.pin_hash, datos.pin);
      // Máximo 5 intentos y después bloqueo con espera creciente.
      const intentos = ok ? 0 : fila.intentos_fallidos + 1;
      const minutos = intentos >= 5 ? Math.min(60, 2 ** (intentos - 5)) : 0;
      await tx
        .updateTable('pines')
        .set({
          intentos_fallidos: intentos,
          bloqueado_hasta: minutos ? new Date(Date.now() + minutos * 60_000) : null,
          updated_at: new Date(),
        })
        .where('id', '=', fila.id)
        .execute();
      if (!ok) return { error: credencialesInvalidas() };
      await auditar(
        tx,
        { usuarioId: fila.usuario_id, kioscoId: disp.kiosco_id, esSoporte: false },
        'sesion.pin',
        { dispositivo: disp.dispositivo_id },
        req.ip,
      );
      return { usuarioId: fila.usuario_id };
    });
    if ('error' in usuarioId) throw usuarioId.error;

    if (req.sesion) await borrarSesion(app.base, req.sesion.tokenHash);
    const token = await crearSesion(app.base, {
      usuarioId: usuarioId.usuarioId,
      kioscoId: disp.kiosco_id,
      rol: 'cajero',
      dispositivoId: disp.dispositivo_id,
      tipo: 'completa',
    });
    ponerCookieSesion(app, reply, token);
    return { ok: true, kioscoId: disp.kiosco_id };
  });
}

const invitacionVencida = () =>
  new ErrorPublico(
    404,
    'invitacion',
    'La invitación venció o ya se usó. Pedile una nueva a quien te invitó.',
  );

/** Después de configurar un segundo factor: si era el primero, activa y da códigos de recuperación. */
async function terminarConfiguracion(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  s: Sesion,
) {
  const t = await leerTotp(app.base, s.usuarioId);
  const codigos = t?.segundo_factor_activo ? null : await nuevosCodigos(app, s.usuarioId);
  if (s.tipo === 'pendiente_2fa') {
    const estado = await completar(app, req, reply, s);
    return { ...estado, codigosRecuperacion: codigos };
  }
  if (s.kioscoId) {
    await withKiosco(app.base, s.kioscoId, (tx) =>
      auditar(tx, s, 'cuenta.segundo_factor', {}, req.ip),
    );
  }
  return { codigosRecuperacion: codigos };
}
