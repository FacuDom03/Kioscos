// Funciones del comercio (docs/decisiones/009-rubros.md): una función se usa solo si el dueño la
// activó y su plan la incluye. La interfaz esconde lo que no corresponde; acá se valida igual.
import type { TxKiosco } from '@mostrador/db';
import { DATOS_MODULOS, moduloEnPlan, type Modulo } from '@mostrador/shared';
import { ErrorPublico } from '../errores.ts';

export async function tieneModulo(tx: TxKiosco, modulo: Modulo): Promise<boolean> {
  const k = await tx.selectFrom('kioscos').select(['plan', 'modulos']).executeTakeFirst();
  return !!k && k.modulos.includes(modulo) && moduloEnPlan(modulo, k.plan);
}

export async function exigirModulo(tx: TxKiosco, modulo: Modulo): Promise<void> {
  if (!(await tieneModulo(tx, modulo)))
    throw new ErrorPublico(
      403,
      'sin_funcion',
      `«${DATOS_MODULOS[modulo].nombre}» no está activado en este comercio. Lo activa el dueño en Más → Tu negocio.`,
    );
}
