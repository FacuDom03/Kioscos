import {
  ErrorPlanilla,
  escribirXlsx,
  filasDeXlsxParaImportar,
  leerXlsx,
  planillaModelo,
} from '@mostrador/shared';
import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo } from '../../nucleo/catalogo.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { navegar } from '../../nucleo/ruta.ts';

interface Resultado {
  creados: number;
  actualizados: number;
  errores: { linea: number; motivo: string }[];
}

/** Las filas de la planilla, como CSV para la importación (todas las celdas entre comillas). */
const comoCsv = (filas: string[][]) =>
  filas.map((f) => f.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')).join('\r\n');

export function ImportarProductos() {
  const negocio = useNegocio();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function descargarModelo() {
    const xlsx = escribirXlsx(
      planillaModelo({
        rubro: negocio.rubro,
        unidades: negocio.tiene('venta_fraccionada'),
        ubicaciones: negocio.tiene('ubicaciones'),
        gremio: negocio.tiene('listas_precios'),
      }),
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([xlsx as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    a.download = 'productos-mostrador.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  async function subir(archivo: File) {
    setError(null);
    setResultado(null);
    if (/\.xls$/i.test(archivo.name)) {
      setError('Ese es un Excel viejo (.xls). Abrilo y guardalo como .xlsx.');
      return;
    }
    const esXlsx = /\.xlsx$/i.test(archivo.name);
    if (archivo.size > (esXlsx ? 10_000_000 : 2_000_000)) {
      setError(`El archivo es muy grande (máximo ${esXlsx ? 10 : 2} MB).`);
      return;
    }
    setCargando(true);
    try {
      const csv = esXlsx
        ? comoCsv(
            filasDeXlsxParaImportar(
              await leerXlsx(new Uint8Array(await archivo.arrayBuffer()), 6000),
            ),
          )
        : await archivo.text();
      if (csv.length > 2_000_000) {
        setError('La planilla tiene demasiados datos. Dividila en dos archivos.');
        return;
      }
      setResultado(await api<Resultado>('POST', '/api/v1/productos/importar', { csv }));
      await refrescarCatalogo();
    } catch (e) {
      setError(e instanceof ErrorPlanilla ? e.message : mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="pantalla">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Importar productos</h1>
      <ol className="pasos-importar">
        <li>
          <h2 className="subtitulo">Descargá la planilla modelo</h2>
          <p className="texto-suave">
            Ya viene con las columnas y unos ejemplos. En la segunda hoja te explica qué va en cada
            una.
          </p>
          <button type="button" className="m-boton" onClick={descargarModelo}>
            Descargar planilla (Excel)
          </button>
        </li>
        <li>
          <h2 className="subtitulo">Llenala con tus productos</h2>
          <p className="texto-suave">
            Borrá los ejemplos y dejá la primera fila como está. Solo el nombre y el precio son
            obligatorios. Si un código ya existe, se actualiza ese producto en lugar de crear otro.
          </p>
        </li>
        <li>
          <h2 className="subtitulo">Subila</h2>
          <p className="texto-suave">Sirve el Excel (.xlsx) o un CSV.</p>
          <label className="m-boton m-boton--principal subir-archivo">
            {cargando ? 'Cargando…' : 'Elegir archivo'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="m-solo-lectores"
              disabled={cargando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void subir(f);
              }}
            />
          </label>
        </li>
      </ol>
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
