import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ErrorApi, eventosSesion } from './api.ts';
import { navegar } from './ruta.ts';

export type Rol = 'dueno' | 'encargado' | 'cajero' | 'soporte';

export interface SesionCompleta {
  tipo: 'completa';
  usuario: { id: string; nombre: string };
  rol: Rol;
  kiosco: { id: string; nombre: string; plan: string };
  kioscos: { id: string; nombre: string; rol: Rol }[];
  esSoporte: boolean;
  enDispositivo: boolean;
}

export interface SesionPendiente {
  tipo: 'pendiente_2fa';
  paso: 'segundo_factor' | 'configurar_segundo_factor';
  metodos?: { totp: boolean; passkey: boolean };
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
      setEstado(await api<SesionPendiente | SesionCompleta>('GET', '/api/v1/auth/yo'));
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) setEstado({ tipo: 'sin_sesion' });
      else throw e;
    }
  }, []);

  useEffect(() => {
    api<SesionPendiente | SesionCompleta>('GET', '/api/v1/auth/yo')
      .then(setEstado)
      .catch(() => setEstado({ tipo: 'sin_sesion' }));
    const vencida = () => setEstado({ tipo: 'sin_sesion' });
    eventosSesion.addEventListener('vencida', vencida);
    return () => eventosSesion.removeEventListener('vencida', vencida);
  }, []);

  const salir = useCallback(async () => {
    await api('POST', '/api/v1/auth/salir', {}).catch(() => undefined);
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
