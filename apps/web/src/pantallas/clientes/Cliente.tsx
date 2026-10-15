import { formatearPlata, uuidv7 } from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import {
  TIPOS_MOVIMIENTO,
  enPalabras,
  enlaceWhatsAppCliente,
  textoCuenta,
  type ClienteDetalle,
  type MovimientoCuenta,
} from '../../nucleo/clientes.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

/** Movimientos (del más nuevo al más viejo) con lo que quedaba debiendo después de cada uno. */
function conSaldo(saldoActual: number, movimientos: MovimientoCuenta[]) {
  const salida: (MovimientoCuenta & { despues: number })[] = [];
  let saldo = saldoActual;
  for (const m of movimientos) {
    salida.push({ ...m, despues: saldo });
    saldo -= m.monto;
  }
  return salida;
}

/** Cuenta de un cliente: saldo, movimientos, pagos y datos (etapa I5). */
export function ClientePantalla({ id }: { id: string }) {
  const s = useSesionCompleta();
  const { datos: c, error, recargar } = useDatos<ClienteDetalle>(`/api/v1/clientes/${id}`);
  const [monto, setMonto] = useState<number | null>(null);
  const [medio, setMedio] = useState<'efectivo' | 'transferencia'>('efectivo');
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorPago, setErrorPago] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [limite, setLimite] = useState<number | null>(null);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const editaLimite = s.rol !== 'cajero';
  const volver = () => navegar('/clientes');

  if (error)
    return (
      <div className="pantalla">
        <Volver onClick={volver} />
        <Aviso>{error}</Aviso>
      </div>
    );
  if (!c) return <div className="pantalla" aria-busy="true" />;

  async function pagar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!monto) {
      setErrorPago('Poné cuánto paga.');
      return;
    }
    setErrorPago(null);
    try {
      const r = await api<{ saldo: number; mensaje: string }>(
        'POST',
        `/api/v1/clientes/${id}/pagos`,
        {
          id: uuidv7(),
          monto,
          medio,
        },
      );
      setAviso(r.mensaje);
      setMonto(null);
      await recargar();
    } catch (e) {
      setErrorPago(mensajeDeError(e));
    }
  }

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const telefono = String(f.get('telefono') ?? '').trim();
    const nota = String(f.get('nota') ?? '').trim();
    try {
      await api('PATCH', `/api/v1/clientes/${id}`, {
        nombre: String(f.get('nombre') ?? '').trim(),
        telefono: telefono || null,
        nota: nota || null,
        ...(editaLimite ? { limite } : {}),
      });
      setEditando(false);
      await recargar();
    } catch (e) {
      setErrorEdicion(mensajeDeError(e));
    }
  }

  const filas = conSaldo(c.saldo, c.movimientos);

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={volver} />
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">{c.nombre}</h1>
        <span className={c.saldo > 0 ? 'saldo saldo--debe saldo--grande' : 'saldo saldo--grande'}>
          {enPalabras(c.saldo)}
        </span>
      </div>
      <p className="texto-suave">
        {c.limite != null ? `Límite: ${formatearPlata(c.limite)}` : 'Sin límite'}
        {c.telefono && ` · ${c.telefono}`}
        {c.nota && ` · ${c.nota}`}
      </p>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      <div className="acciones">
        {c.telefono && (
          <a
            className="m-boton boton-enlace"
            href={enlaceWhatsAppCliente(
              c.telefono,
              textoCuenta(s.kiosco.nombre, c.nombre, c.saldo),
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            Mandarle el resumen por WhatsApp
          </a>
        )}
        <button
          type="button"
          className="m-boton"
          onClick={() => {
            setLimite(c.limite);
            setEditando(!editando);
          }}
        >
          Editar datos
        </button>
      </div>

      {editando && (
        <form className="formulario tarjeta-form" onSubmit={guardar}>
          <h2 className="subtitulo">Datos de {c.nombre}</h2>
          <div className="dos-columnas">
            <Campo
              etiqueta="Nombre"
              name="nombre"
              maxLength={80}
              defaultValue={c.nombre}
              required
            />
            <Campo
              etiqueta="Teléfono (opcional)"
              name="telefono"
              type="tel"
              maxLength={30}
              pattern="[0-9 +()\-]{6,30}"
              defaultValue={c.telefono ?? ''}
            />
          </div>
          <Campo
            etiqueta="Nota (opcional)"
            name="nota"
            maxLength={200}
            defaultValue={c.nota ?? ''}
            placeholder="Por ejemplo, la dirección"
          />
          {editaLimite && (
            <CampoPlata
              etiqueta="Límite (vacío: sin límite)"
              valor={limite}
              alCambiar={setLimite}
            />
          )}
          {errorEdicion && <Aviso>{errorEdicion}</Aviso>}
          <button className="m-boton m-boton--accion">Guardar</button>
        </form>
      )}

      <form className="formulario tarjeta-form" onSubmit={pagar}>
        <h2 className="subtitulo">Registrar un pago</h2>
        <div className="dos-columnas">
          <CampoPlata etiqueta="¿Cuánto paga?" valor={monto} alCambiar={setMonto} />
          <fieldset className="campo">
            <legend>¿Cómo paga?</legend>
            <div className="chips">
              {(['efectivo', 'transferencia'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip"
                  aria-pressed={medio === m}
                  onClick={() => setMedio(m)}
                >
                  {m === 'efectivo' ? 'Efectivo' : 'Transferencia'}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {c.saldo > 0 && (
          <button type="button" className="enlace-boton" onClick={() => setMonto(c.saldo)}>
            Paga todo ({formatearPlata(c.saldo)})
          </button>
        )}
        {errorPago && <Aviso>{errorPago}</Aviso>}
        <button className="m-boton m-boton--accion">Registrar pago</button>
      </form>

      <section aria-labelledby="titulo-movimientos">
        <h2 className="subtitulo" id="titulo-movimientos">
          Movimientos
        </h2>
        {filas.length === 0 ? (
          <p className="vacio">Todavía no tiene movimientos.</p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Qué</th>
                  <th scope="col" className="num">
                    Monto
                  </th>
                  <th scope="col" className="num">
                    Queda
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleDateString('es-AR')}</td>
                    <td>
                      {TIPOS_MOVIMIENTO[m.tipo]}
                      {m.medio && ` en ${m.medio}`}
                      {m.nota && <span className="texto-suave"> · {m.nota}</span>}
                    </td>
                    <td className="num">
                      {m.monto > 0 ? '+' : '−'} {formatearPlata(Math.abs(m.monto))}
                    </td>
                    <td className="num">{enPalabras(m.despues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
