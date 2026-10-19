import { COMPROBANTES_COMPRA, formatearPlata, type ComprobanteCompra } from '@mostrador/shared';
import { useState } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { pedirTexto } from '../../componentes/Dialogos.tsx';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { BuscadorProductos } from '../../componentes/BuscadorProductos.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo, type Producto } from '../../nucleo/catalogo.ts';
import { hoyArgentina } from '../../nucleo/descargar.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

// Cargar compra como una factura de compra: de quién y qué comprobante, y cada renglón con su
// cantidad, su costo y si suma stock (si la mercadería ya entró con el remito, no se suma otra
// vez). También renglones sin producto: flete, bolsas, un servicio.

interface Renglon {
  clave: number;
  producto: Producto | null;
  descripcion: string;
  cantidad: string;
  costo: number | null;
  margen: string;
  sumaStock: boolean;
}

interface Proveedor {
  id: string;
  nombre: string;
}

const numeroDe = (texto: string) => Number(texto.replace(',', '.'));
const costoFinal = (costo: number, sumarIva: boolean) =>
  sumarIva ? Math.round(costo * 1.21) : costo;
const subtotal = (r: Renglon, conIva: boolean) =>
  Math.round((numeroDe(r.cantidad) || 0) * costoFinal(r.costo ?? 0, conIva));

let siguienteClave = 1;

export function CargarCompra() {
  const proveedores = useDatos<Proveedor[]>('/api/v1/proveedores');
  const [proveedorId, setProveedorId] = useState('');
  const [comprobante, setComprobante] = useState<ComprobanteCompra | ''>('');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(hoyArgentina());
  const [entra, setEntra] = useState(true);
  const [sumarIva, setSumarIva] = useState(false);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [control, setControl] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const nuevo = (producto: Producto | null): Renglon => ({
    clave: siguienteClave++,
    producto,
    descripcion: '',
    cantidad: '1',
    costo: producto?.costo ?? null,
    margen: '',
    sumaStock: producto ? entra : false,
  });
  const agregar = (p: Producto) =>
    setRenglones((rs) => (rs.some((r) => r.producto?.id === p.id) ? rs : [...rs, nuevo(p)]));
  const cambiar = (clave: number, cambio: Partial<Renglon>) =>
    setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)));
  const total = renglones.reduce((t, r) => t + subtotal(r, sumarIva), 0);

  async function nuevoProveedor() {
    const nombre = await pedirTexto({
      titulo: 'Proveedor nuevo',
      etiqueta: 'Nombre del proveedor',
      aceptar: 'Agregar proveedor',
      valido: (v) => v.length <= 80,
      error: 'Usá hasta 80 letras.',
    });
    if (!nombre) return;
    try {
      const { id } = await api<{ id: string }>('POST', '/api/v1/proveedores', { nombre });
      await proveedores.recargar();
      setProveedorId(id);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function guardar() {
    setError(null);
    const items = renglones.map((r) => ({
      ...(r.producto ? { productoId: r.producto.id } : { descripcion: r.descripcion.trim() }),
      cantidad: numeroDe(r.cantidad),
      costoUnitario: r.costo === null ? -1 : costoFinal(r.costo, sumarIva),
      ...(r.producto && r.margen.trim() ? { margen: numeroDe(r.margen) } : {}),
      ...(r.producto ? { sumaStock: r.sumaStock } : {}),
    }));
    if (items.some((i) => !(i.cantidad > 0) || i.costoUnitario < 0)) {
      setError('Revisá que cada renglón tenga cantidad y costo.');
      return;
    }
    if (renglones.some((r) => !r.producto && !r.descripcion.trim())) {
      setError('Escribí qué es cada renglón sin producto (por ejemplo, "Flete").');
      return;
    }
    setGuardando(true);
    try {
      await api('POST', '/api/v1/compras', {
        items,
        ...(proveedorId ? { proveedorId } : {}),
        ...(comprobante ? { comprobante } : {}),
        ...(comprobante && numero.trim() ? { numero: numero.trim() } : {}),
        fecha,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      await refrescarCatalogo();
      navegar('/compras');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  const diferencia = control === null ? null : control - total;

  return (
    <div className="pantalla pantalla--ancha factura-compra">
      <Volver onClick={() => navegar('/compras')} />
      <h1 className="m-titulo">Cargar compra</h1>
      <p className="texto-suave">
        Cargá la factura del proveedor: los productos que llegaron, con cantidad y costo.
      </p>

      <section className="tarjeta-form factura-compra__datos" aria-label="Datos de la factura">
        <div className="campo">
          <label htmlFor="compra-proveedor">Proveedor</label>
          <div className="factura-compra__proveedor">
            <select
              id="compra-proveedor"
              className="campo__entrada"
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
            >
              <option value="">Sin proveedor</option>
              {proveedores.datos?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <button type="button" className="m-boton" onClick={nuevoProveedor}>
              Nuevo
            </button>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="compra-comprobante">Comprobante</label>
          <select
            id="compra-comprobante"
            className="campo__entrada"
            value={comprobante}
            onChange={(e) => setComprobante(e.target.value as ComprobanteCompra | '')}
          >
            <option value="">Sin comprobante</option>
            {Object.entries(COMPROBANTES_COMPRA).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
        </div>
        {comprobante && (
          <div className="campo">
            <label htmlFor="compra-numero">Número</label>
            <input
              id="compra-numero"
              className="campo__entrada"
              inputMode={comprobante === 'ticket' || comprobante === 'otro' ? 'text' : 'numeric'}
              placeholder={
                comprobante === 'ticket' || comprobante === 'otro' ? '' : '0003-00001234'
              }
              maxLength={30}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
            />
          </div>
        )}
        <div className="campo">
          <label htmlFor="compra-fecha">Fecha de la factura</label>
          <input
            id="compra-fecha"
            className="campo__entrada"
            type="date"
            max={hoyArgentina()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyArgentina())}
          />
        </div>
        <div className="campo">
          <label htmlFor="compra-entra">¿La mercadería entra ahora?</label>
          <select
            id="compra-entra"
            className="campo__entrada"
            value={entra ? 'si' : 'no'}
            onChange={(e) => {
              const si = e.target.value === 'si';
              setEntra(si);
              setRenglones((rs) => rs.map((r) => (r.producto ? { ...r, sumaStock: si } : r)));
            }}
          >
            <option value="si">Sí: suma al stock</option>
            <option value="no">No, ya entró (por ejemplo, con el remito)</option>
          </select>
        </div>
        <label className="opcion opcion--check factura-compra__iva">
          <input
            type="checkbox"
            checked={sumarIva}
            onChange={(e) => setSumarIva(e.target.checked)}
          />
          Los costos de la factura no incluyen IVA: sumar 21 %
        </label>
      </section>

      <BuscadorProductos
        alElegir={agregar}
        etiqueta="Agregar producto"
        ayudaEscaner="Cada producto leído se suma a la compra."
      />
      <button
        type="button"
        className="enlace-boton"
        onClick={() => setRenglones((rs) => [...rs, nuevo(null)])}
      >
        Agregar renglón sin producto (flete, bolsas, un servicio)
      </button>

      <ul className="lista-filas">
        {renglones.map((r) => (
          <li key={r.clave} className="tarjeta tarjeta--compra">
            {r.producto ? (
              <strong className="tarjeta--compra__nombre">{r.producto.nombre}</strong>
            ) : (
              <div className="campo">
                <label htmlFor={`desc-${r.clave}`}>Qué es</label>
                <input
                  id={`desc-${r.clave}`}
                  className="campo__entrada"
                  placeholder="Flete"
                  maxLength={120}
                  value={r.descripcion}
                  onChange={(e) => cambiar(r.clave, { descripcion: e.target.value })}
                />
              </div>
            )}
            <div className="campo">
              <label htmlFor={`cant-${r.clave}`}>Cantidad</label>
              <input
                id={`cant-${r.clave}`}
                className="campo__entrada"
                inputMode="decimal"
                value={r.cantidad}
                onChange={(e) => cambiar(r.clave, { cantidad: e.target.value })}
              />
            </div>
            <CampoPlata
              etiqueta="Costo por unidad"
              valor={r.costo}
              alCambiar={(c) => cambiar(r.clave, { costo: c })}
            />
            {r.producto ? (
              <div className="campo">
                <label htmlFor={`margen-${r.clave}`}>Margen % (opcional)</label>
                <input
                  id={`margen-${r.clave}`}
                  className="campo__entrada"
                  inputMode="decimal"
                  placeholder="Deja el precio igual"
                  value={r.margen}
                  onChange={(e) => cambiar(r.clave, { margen: e.target.value })}
                />
              </div>
            ) : (
              <span />
            )}
            <div className="tarjeta--compra__pie">
              {r.producto ? (
                <label className="opcion opcion--check">
                  <input
                    type="checkbox"
                    checked={r.sumaStock}
                    onChange={(e) => cambiar(r.clave, { sumaStock: e.target.checked })}
                  />
                  Suma al stock
                </label>
              ) : (
                <span className="texto-suave">No mueve stock</span>
              )}
              <span className="m-plata">{formatearPlata(subtotal(r, sumarIva))}</span>
              <button
                type="button"
                className="enlace-boton"
                onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}
              >
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {renglones.length > 0 && (
        <section className="factura-compra__totales" aria-label="Total">
          <p className="total-linea">
            Total de la compra{sumarIva ? ' (con IVA)' : ''}:{' '}
            <strong className="m-plata">{formatearPlata(total)}</strong>
          </p>
          <CampoPlata
            etiqueta="Total que dice la factura (opcional, para controlar)"
            valor={control}
            alCambiar={setControl}
          />
          {diferencia !== null && (
            <Aviso tipo={diferencia === 0 ? 'ok' : 'info'}>
              {diferencia === 0
                ? 'Coincide con la factura.'
                : `Hay una diferencia de ${formatearPlata(Math.abs(diferencia))}: revisá cantidades y costos.`}
            </Aviso>
          )}
          <div className="campo">
            <label htmlFor="nota-compra">Nota (opcional)</label>
            <input
              id="nota-compra"
              className="campo__entrada"
              value={nota}
              maxLength={500}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        </section>
      )}
      {error && <Aviso>{error}</Aviso>}
      <button
        type="button"
        className="m-boton m-boton--principal"
        disabled={!renglones.length || guardando}
        onClick={guardar}
      >
        Guardar compra
      </button>
    </div>
  );
}
