import { Toldo } from '@mostrador/ui';
import type { ReactNode } from 'react';

/** Marco de las pantallas de ingreso: toldo y una columna centrada. */
export function MarcoAcceso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="acceso">
      <Toldo />
      <main className="acceso__contenido" id="contenido">
        <p className="acceso__marca" translate="no">
          Mostrador
        </p>
        <h1 className="m-titulo">{titulo}</h1>
        {children}
      </main>
    </div>
  );
}
