// Matriz de la prueba de aislamiento por rutas (sección 8 de docs/SPEC.md).
//
// Cada ruta nueva de la API tiene que figurar acá: o es pública (lista corta y revisada), o tiene
// un caso que, autenticado como el kiosco A, intenta leer, editar o borrar un recurso del kiosco B
// por ID y espera 404 sin cambios en la base. La prueba `rutas.test.ts` falla si falta alguna.
//
// En la Etapa A todavía no hay sesiones ni rutas de negocio: la matriz arranca vacía y se llena
// a partir de la Etapa B.

export const RUTAS_PUBLICAS: readonly string[] = ['GET /health'];

export interface CasoAislamiento {
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Igual que en Fastify, por ejemplo `/api/v1/productos/:id`. */
  url: string;
  /** Tabla de la que se toma un ID del kiosco B para reemplazar `:id`. */
  tabla: string;
  cuerpo?: unknown;
}

export const CASOS_AISLAMIENTO: readonly CasoAislamiento[] = [];
