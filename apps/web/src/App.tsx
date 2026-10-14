import { Marco, type Seccion } from '@mostrador/ui';
import { useState } from 'react';
import { Apariencia } from './pantallas/Apariencia.tsx';
import { Mas } from './pantallas/Mas.tsx';
import { Proximamente } from './pantallas/Proximamente.tsx';
import { Vender } from './pantallas/Vender.tsx';

type Pantalla = Seccion | 'apariencia';

export function App() {
  // La app abre directo en Vender.
  const [pantalla, setPantalla] = useState<Pantalla>('vender');
  const seccion: Seccion = pantalla === 'apariencia' ? 'mas' : pantalla;
  const estado = <span className="m-estado">En línea</span>;

  return (
    <Marco seccion={seccion} alCambiar={setPantalla} estado={estado}>
      {pantalla === 'vender' && <Vender estado={estado} />}
      {pantalla === 'stock' && <Proximamente titulo="Stock" />}
      {pantalla === 'caja' && <Proximamente titulo="Caja" />}
      {pantalla === 'mas' && <Mas alAbrirApariencia={() => setPantalla('apariencia')} />}
      {pantalla === 'apariencia' && <Apariencia alVolver={() => setPantalla('mas')} />}
    </Marco>
  );
}
