import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigoTotp } from '@mostrador/servidor';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  Cliente,
  crearEntorno,
  invitar,
  nuevoKiosco,
  type Entorno,
} from './ayuda.ts';

let e: Entorno;

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

const MENSAJE_LOGIN = 'Email, contraseña o código incorrectos.';

describe('invitación, contraseña y segundo factor', () => {
  it('el dueño acepta la invitación, configura TOTP y queda con sesión completa', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    expect(dueno.codigos).toHaveLength(10);
    const yo = await dueno.cliente.get('/api/v1/auth/yo');
    expect(yo.statusCode).toBe(200);
    expect(yo.json()).toMatchObject({ tipo: 'completa', rol: 'dueno', kiosco: { id: kiosco } });
    // La cookie es de sesión del servidor, HttpOnly.
    expect(dueno.cliente.cookies.has('__Host-mostrador')).toBe(true);
  });

  it('la invitación es de un solo uso', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const token = await invitar(e.admin, kiosco, `uno-${kiosco}@ejemplo.test`, 'dueno');
    const c = new Cliente(e.app);
    expect((await c.get(`/api/v1/auth/invitaciones/${token}`)).statusCode).toBe(200);
    expect(
      (
        await c.post(`/api/v1/auth/invitaciones/${token}`, {
          nombre: 'A',
          password: 'una contraseña larga',
        })
      ).statusCode,
    ).toBe(200);
    const otra = new Cliente(e.app);
    const r = await otra.post(`/api/v1/auth/invitaciones/${token}`, {
      nombre: 'B',
      password: 'otra contraseña larga',
    });
    expect(r.statusCode).toBe(404);
  });

  it('login con contraseña y TOTP; los errores dicen siempre lo mismo', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const c = new Cliente(e.app);

    const malEmail = await c.post('/api/v1/auth/login', {
      email: 'nadie@ejemplo.test',
      password: 'lo que sea',
    });
    const malPass = await c.post('/api/v1/auth/login', {
      email: dueno.email,
      password: 'incorrecta',
    });
    expect(malEmail.statusCode).toBe(401);
    expect(malPass.statusCode).toBe(401);
    expect(malEmail.json().error).toBe(MENSAJE_LOGIN);
    expect(malPass.json().error).toBe(MENSAJE_LOGIN);

    const ok = await c.post('/api/v1/auth/login', { email: dueno.email, password: dueno.password });
    expect(ok.json()).toMatchObject({ paso: 'segundo_factor', metodos: { totp: true } });
    // Con la sesión pendiente no se entra a nada.
    expect((await c.get('/api/v1/usuarios')).statusCode).toBe(401);

    const malCodigo = await c.post('/api/v1/auth/totp', { codigo: '000000' });
    expect(malCodigo.json().error).toBe(MENSAJE_LOGIN);
    const r = await c.post('/api/v1/auth/totp', { codigo: codigoTotp(dueno.secretoTotp) });
    expect(r.statusCode).toBe(200);
    expect((await c.get('/api/v1/usuarios')).statusCode).toBe(200);

    expect((await c.post('/api/v1/auth/salir')).statusCode).toBe(200);
    expect((await c.get('/api/v1/usuarios')).statusCode).toBe(401);
  });

  it('un código de recuperación sirve una sola vez', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const entrar = async () => {
      const c = new Cliente(e.app);
      await c.post('/api/v1/auth/login', { email: dueno.email, password: dueno.password });
      return c.post('/api/v1/auth/recuperacion', { codigo: dueno.codigos[0] });
    };
    expect((await entrar()).statusCode).toBe(200);
    expect((await entrar()).statusCode).toBe(401);
  });

  it('después de 5 contraseñas mal, la cuenta se bloquea un rato', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const c = new Cliente(e.app);
    for (let i = 0; i < 5; i++)
      await c.post('/api/v1/auth/login', { email: dueno.email, password: 'incorrecta' });
    const r = await c.post('/api/v1/auth/login', { email: dueno.email, password: dueno.password });
    expect(r.statusCode).toBe(429);
  });

  it('una sesión completa no puede volver a pasar por el segundo factor', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const r = await dueno.cliente.post('/api/v1/auth/totp', {
      codigo: codigoTotp(dueno.secretoTotp),
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('cajero con PIN en un dispositivo registrado', () => {
  it('entra con PIN en el equipo autorizado y no en otro', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const { cajero, membresiaId } = await cajeroEnEquipo(dueno, e.app);
    expect((await cajero.get('/api/v1/auth/yo')).json()).toMatchObject({
      rol: 'cajero',
      enDispositivo: true,
    });

    const otroEquipo = new Cliente(e.app);
    const r = await otroEquipo.post('/api/v1/auth/pin', { membresiaId, pin: '1234' });
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toBe('equipo');
    expect((await otroEquipo.get('/api/v1/auth/pin/personas')).json()).toEqual({
      dispositivo: null,
      personas: [],
    });
  });

  it('el equipo autorizado lista solo a los cajeros de su kiosco', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const { cajero, membresiaId } = await cajeroEnEquipo(dueno, e.app);
    const r = await cajero.get('/api/v1/auth/pin/personas');
    expect(r.json().personas).toEqual([{ id: membresiaId, nombre: expect.any(String) }]);
  });

  it('el cajero no puede usar rutas del dueño', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    expect((await cajero.get('/api/v1/usuarios')).statusCode).toBe(403);
    expect((await cajero.post('/api/v1/dispositivos', { nombre: 'Otro' })).statusCode).toBe(403);
  });

  it('5 PIN mal bloquean al cajero aunque después ponga el bueno', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const { membresiaId, cookieEquipo } = await cajeroEnEquipo(dueno, e.app, '4321');
    const c = new Cliente(e.app);
    c.cookies.set('__Host-mostrador-equipo', cookieEquipo);
    for (let i = 0; i < 5; i++)
      expect((await c.post('/api/v1/auth/pin', { membresiaId, pin: '0000' })).statusCode).toBe(401);
    expect((await c.post('/api/v1/auth/pin', { membresiaId, pin: '4321' })).statusCode).toBe(429);
  });

  it('si el dueño revoca el equipo, la sesión del cajero se corta', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    const equipos = (await dueno.cliente.get('/api/v1/dispositivos')).json<{ id: string }[]>();
    expect((await dueno.cliente.delete(`/api/v1/dispositivos/${equipos[0]!.id}`)).statusCode).toBe(
      200,
    );
    expect((await cajero.get('/api/v1/kiosco')).statusCode).toBe(401);
  });

  it('el PIN no se acepta si tiene letras o menos de 4 números', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const r = await dueno.cliente.post('/api/v1/usuarios/cajeros', { nombre: 'X', pin: '12a' });
    expect(r.statusCode).toBe(400);
  });
});

describe('reglas generales', () => {
  it('todo lo que modifica datos exige el Origin de la app', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    dueno.cliente.origen = 'https://otro-sitio.test';
    expect((await dueno.cliente.post('/api/v1/dispositivos', { nombre: 'X' })).statusCode).toBe(
      403,
    );
    dueno.cliente.origen = null;
    expect((await dueno.cliente.post('/api/v1/dispositivos', { nombre: 'X' })).statusCode).toBe(
      403,
    );
  });

  it('un campo de más se rechaza', async () => {
    const c = new Cliente(e.app);
    const r = await c.post('/api/v1/auth/login', {
      email: 'a@b.test',
      password: 'x',
      rol: 'dueno',
    });
    expect(r.statusCode).toBe(400);
  });

  it('el límite de usuarios del plan se valida en el servidor', async () => {
    const kiosco = await nuevoKiosco(e.admin, 'esencial');
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const r = await dueno.cliente.post('/api/v1/usuarios/cajeros', {
      nombre: 'Uno más',
      pin: '1234',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('limite_plan');
  });

  it('el acceso de soporte se prende por 24 horas y queda en la auditoría', async () => {
    const kiosco = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kiosco);
    const r = await dueno.cliente.put('/api/v1/kiosco/soporte', { activo: true });
    const hasta = new Date(r.json().soporte_hasta).getTime();
    expect(hasta - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    const audit = (await dueno.cliente.get('/api/v1/auditoria')).json<{ accion: string }[]>();
    expect(audit.map((a) => a.accion)).toContain('soporte.activado');
  });
});
