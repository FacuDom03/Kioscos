import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';

interface Resultado {
  creados: number;
  actualizados: number;
  errores: { linea: number; motivo: string }[];
}

export function ImportarProductos() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function subir(archivo: File) {
    setError(null);
    setResultado(null);
    if (archivo.size > 2_000_000) {
      setError('El archivo es muy grande (máximo 2 MB).');
      return;
    }
    setCargando(true);
    try {
      const csv = await archivo.text();
      setResultado(await api<Resultado>('POST', '/api/v1/productos/importar', { csv }));
      await refrescarCatalogo();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Importar productos</h1>
      <p>
        Desde Excel, guardá la planilla como <strong>CSV</strong>. La primera fila tiene que tener
        los nombres de las columnas:
      </p>
      <p className="ejemplo-csv">
        <code>nombre;precio;codigo;categoria;costo;stock;minimo</code>
      </p>
      <p className="texto-suave">
        Solo "nombre" y "precio" son obligatorias. Si un código ya existe, se actualiza ese producto
        en lugar de crear otro.
      </p>
      <label className="m-boton m-boton--principal subir-archivo">
        {cargando ? 'Cargando…' : 'Elegir archivo'}
        <input
          type="file"
          accept=".csv,text/csv"
          className="m-solo-lectores"
          onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])}
        />
      </label>
      {error && <Aviso>{error}</Aviso>}
      {resultado && (
        <Aviso tipo="ok">
          Listo: {resultado.creados} productos nuevos y {resultado.actualizados} actualizados.
          {resultado.errores.length > 0 && ` ${resultado.errores.length} filas no se cargaron.`}
        </Aviso>
      )}
      {resultado && resultado.errores.length > 0 && (
        <ul className="lista-errores">
          {resultado.errores.slice(0, 50).map((e) => (
            <li key={e.linea}>
              Fila {e.linea}: {e.motivo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
