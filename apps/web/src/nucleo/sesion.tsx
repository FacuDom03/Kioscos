import type { Modulo, Rubro } from '@mostrador/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ErrorApi, eventosSesion } from './api.ts';
import { navegar } from './ruta.ts';
import { borrarClave, guardarClave, leerClave } from './local.ts';

export type Rol = 'dueno' | 'encargado' | 'cajero' | 'soporte';

import type { Marca } from '../componentes/Marca.tsx';

export interface SesionCompleta {
  tipo: 'completa';
  usuario: { id: string; nombre: string };
  rol: Rol;
  kiosco: {
    id: string;
    nombre: string;
    plan: string;
    /** Puede faltar en una sesión guardada por una versión anterior de la app. */
    rubro?: Rubro;
    modulos?: Modulo[];
    configurado?: boolean;
    /** Logo y pie de los tickets. Falta en sesiones de versiones anteriores. */
    marca?: Marca;
  };
  kioscos: { id: string; nombre: string; rol: Rol }[];
  esSoporte: boolean;
  enDispositivo: boolean;
}

export interface SesionPendiente {
  tipo: 'pendiente_2fa';
  paso: 'segundo_factor' | 'configurar_segundo_factor';
  metodos?: { totp: boolean; passkey: boolean };
}

const CLAVE_SESION = 'sesion';

/** Copia mínima de la sesión para seguir vendiendo si la app abre sin conexión. */
async function recordar(e: SesionPendiente | SesionCompleta) {
  if (e.tipo === 'completa') await guardarClave(CLAVE_SESION, e);
}

export type EstadoSesion =
  { tipo: 'cargando' } | { tipo: 'sin_sesion' } | SesionPendiente | SesionCompleta;

interface Contexto {
  estado: EstadoSesion;
  recargar(): Promise<void>;
  fijar(e: EstadoSesion): void;
  salir(): Promise<void>;
}

const Ctx = createContext<Contexto | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSesion>({ tipo: 'cargando' });

  const recargar = useCallback(async () => {
    try {
      const e = await api<SesionPendiente | SesionCompleta>('GET', '/api/v1/auth/yo');
      await recordar(e);
      setEstado(e);
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) setEstado({ tipo: 'sin_sesion' });
      else throw e;
    }
  }, []);

  useEffect(() => {
    api<SesionPendiente | SesionCompleta>('GET', '/api/v1/auth/yo')
      .then(async (e) => {
        await recordar(e);
        setEstado(e);
      })
      .catch(async (e: unknown) => {
        // Sin conexión: la app sigue con la sesión que ya tenía.
        const guardada =
          e instanceof ErrorApi && e.status === 0
            ? await leerClave<SesionCompleta>(CLAVE_SESION)
            : undefined;
        setEstado(guardada ?? { tipo: 'sin_sesion' });
      });
    const vencida = () => {
      void borrarClave(CLAVE_SESION);
      setEstado({ tipo: 'sin_sesion' });
    };
    eventosSesion.addEventListener('vencida', vencida);
    return () => eventosSesion.removeEventListener('vencida', vencida);
  }, []);

  const salir = useCallback(async () => {
    await api('POST', '/api/v1/auth/salir', {}).catch(() => undefined);
    await borrarClave(CLAVE_SESION);
    // Al volver a entrar, la app abre en Vender.
    navegar('/', true);
    setEstado({ tipo: 'sin_sesion' });
  }, []);

  return (
    <Ctx.Provider value={{ estado, recargar, fijar: setEstado, salir }}>{children}</Ctx.Provider>
  );
}

export function useSesion(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}

/** Solo en pantallas que se muestran con sesión completa. */
export function useSesionCompleta(): SesionCompleta {
  const { estado } = useSesion();
  if (estado.tipo !== 'completa') throw new Error('Sin sesión completa');
  return estado;
}

export const puede = {
  verCostos: (r: Rol) => r !== 'cajero',
  editarCatalogo: (r: Rol) => r === 'dueno' || r === 'encargado' || r === 'soporte',
  administrar: (r: Rol) => r === 'dueno',
};
