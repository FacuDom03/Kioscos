// Catálogo del kiosco en el equipo. Se refresca al abrir la app, al volver el foco, cada
// 5 minutos y después de cada cambio. (En la Etapa E se guarda también en IndexedDB.)
import { buscar, indexar, type Indice } from '@mostrador/shared';
import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { eventosBandeja } from './bandeja.ts';
import { guardarClave, leerClave } from './local.ts';

export interface Producto {
  id: string;
  nombre: string;
  precio: number;
  costo?: number | null;
  categoriaId: string | null;
  stock: number;
  minimo: number;
  codigos: string[];
}

export interface Catalogo {
  generado: string;
  productos: Producto[];
  categorias: { id: string; nombre: string }[];
  masVendidos: string[];
}

interface Estado {
  catalogo: Catalogo | null;
  indice: Indice<Producto> | null;
  porId: Map<string, Producto>;
}

let estado: Estado = { catalogo: null, indice: null, porId: new Map() };
const oyentes = new Set<() => void>();

let kiosco: string | null = null;

function fijar(catalogo: Catalogo, guardar = true) {
  if (guardar && kiosco) void guardarClave(`catalogo:${kiosco}`, catalogo);
  estado = {
    catalogo,
    indice: indexar(catalogo.productos),
    porId: new Map(catalogo.productos.map((p) => [p.id, p])),
  };
  for (const o of oyentes) o();
}

export function reemplazarCatalogo(c: Catalogo): void {
  fijar(c);
}

let pidiendo: Promise<void> | null = null;
export function refrescarCatalogo(): Promise<void> {
  pidiendo ??= api<Catalogo>('GET', '/api/v1/catalogo')
    .then(fijar)
    .finally(() => {
      pidiendo = null;
    });
  return pidiendo;
}

let intervalo: ReturnType<typeof setInterval> | undefined;
/** Carga lo guardado en el equipo (para vender sin conexión) y lo refresca con el servidor. */
export function iniciarRefrescoCatalogo(kioscoId: string): () => void {
  kiosco = kioscoId;
  void leerClave<Catalogo>(`catalogo:${kioscoId}`).then((c) => {
    if (c && !estado.catalogo) fijar(c, false);
  });
  void refrescarCatalogo().catch(() => undefined);
  // Después de cada subida de ventas, el stock cambió.
  const alSincronizar = () => void refrescarCatalogo().catch(() => undefined);
  eventosBandeja.addEventListener('sincronizado', alSincronizar);
  const alVolver = () => {
    if (document.visibilityState === 'visible') void refrescarCatalogo().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', alVolver);
  intervalo = setInterval(() => void refrescarCatalogo().catch(() => undefined), 5 * 60_000);
  return () => {
    document.removeEventListener('visibilitychange', alVolver);
    eventosBandeja.removeEventListener('sincronizado', alSincronizar);
    clearInterval(intervalo);
    kiosco = null;
  };
}

export function olvidarCatalogo(): void {
  estado = { catalogo: null, indice: null, porId: new Map() };
  for (const o of oyentes) o();
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};

export function useCatalogo(): Estado {
  return useSyncExternalStore(suscribir, () => estado);
}

export function buscarProductos(consulta: string, limite = 30): Producto[] {
  return estado.indice ? buscar(estado.indice, consulta, limite) : [];
}

export function productoPorCodigo(codigo: string): Producto | undefined {
  return estado.indice?.porCodigo.get(codigo);
}

export function productoPorId(id: string): Producto | undefined {
  return estado.porId.get(id);
}
