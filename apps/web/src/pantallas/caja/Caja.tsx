import { diferenciaEnPalabras, formatearPlata, uuidv7 } from '@mostrador/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Campo } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { encolar, eventosBandeja, sincronizar, useBandeja } from '../../nucleo/bandeja.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { olvidarTurno, turnoActual, useTurno } from '../../nucleo/turno.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { aplicarActualizacion } from '../../nucleo/actualizacion.ts';
import { AbrirCaja } from '../vender/AbrirCaja.tsx';
import { Pendientes } from './Pendientes.tsx';
import { DetalleHistorial, ListaCierres, ListaVentas } from '../historial/Historial.tsx';

interface DatosCaja {
  turno: { id: string; abiertoEn: string; abiertoPor: string; cambioInicial: number } | null;
  resumen?: {
    vendido: number;
    ventas: number;
    porMedio: { efectivo: number; qr_mp: number; transferencia: number; cuenta_corriente?: number };
    cobrosCuenta?: { efectivo: number; transferencia: number };
    gastos: number;
    retiros: number;
    deberiaHaber: number;
  };
  gastos?: {
    id: string;
    tipo: 'gasto' | 'retiro';
    monto: number;
    motivo: string;
    created_at: string;
  }[];
}

const MEDIOS = [
  { clave: 'efectivo', nombre: 'Efectivo', color: 'var(--chart-1)' },
  { clave: 'qr_mp', nombre: 'QR', color: 'var(--chart-2)' },
  { clave: 'transferencia', nombre: 'Transferencia', color: 'var(--chart-3)' },
] as const;

export function Caja() {
  const s = useSesionCompleta();
  const turno = useTurno();
  const enLinea = useEnLinea();
  const bandeja = useBandeja();
  const { datos, error, recargar } = useDatos<DatosCaja>('/api/v1/caja');
  const [contado, setContado] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  const [errorCierre, setErrorCierre] = useState<string | null>(null);
  const [cierre, setCierre] = useState<{ diferencia: number; contado: number } | null>(null);
  const [gasto, setGasto] = useState<'gasto' | 'retiro' | null>(null);

  useEffect(() => {
    const alSubir = () => void recargar();
    eventosBandeja.addEventListener('subida', alSubir);
    return () => eventosBandeja.removeEventListener('subida', alSubir);
  }, [recargar]);

  if (cierre) {
    return (
      <div className="pantalla">
        <h1 className="m-titulo">Caja cerrada</h1>
        <p
          className={`diferencia ${cierre.diferencia === 0 ? 'diferencia--justo' : 'diferencia--mal'}`}
        >
          {diferenciaEnPalabras(cierre.contado, cierre.contado - cierre.diferencia, formatearPlata)}
          .
        </p>
        <button type="button" className="m-boton m-boton--principal" onClick={() => navegar('/')}>
          Listo
        </button>
      </div>
    );
  }

  if (turno.tipo === 'cerrado') return <AbrirCaja />;
  const r = datos?.resumen;
  const esperado = r?.deberiaHaber ?? 0;
  const diferencia = contado === null ? null : contado - esperado;

  async function cerrar(ev: FormEvent) {
    ev.preventDefault();
    setErrorCierre(null);
    const t = turnoActual();
    if (!t || contado === null) return setErrorCierre('Poné cuánto contaste.');
    // No se puede cerrar la caja con ventas sin subir.
    const listo = await sincronizar();
    if (!listo)
      return setErrorCierre(
        'Hay ventas que todavía no se subieron. Revisá la conexión y probá de nuevo.',
      );
    try {
      const res = await api<{ diferencia: number; contado: number }>(
        'POST',
        `/api/v1/caja/turnos/${t.id}/cerrar`,
        {
          contado,
          ...(nota.trim() ? { nota: nota.trim() } : {}),
        },
      );
      await olvidarTurno();
      setCierre(res);
      // Si había una versión nueva esperando, se aplica al cerrar la caja.
      setTimeout(() => void aplicarActualizacion(), 4000);
    } catch (e) {
      setErrorCierre(mensajeDeError(e));
    }
  }

  async function guardarGasto(ev: FormEvent<HTMLFormElement>, monto: number | null) {
    ev.preventDefault();
    const t = turnoActual();
    const motivo = String(new FormData(ev.currentTarget).get('motivo') ?? '').trim();
    if (!t || !monto || !motivo || !gasto) return;
    await encolar('gasto', {
      id: uuidv7(),
      turnoId: t.id,
      tipo: gasto,
      monto,
      motivo,
      creadoEn: new Date().toISOString(),
    });
    setGasto(null);
    await sincronizar();
    await recargar();
  }

  const total = r?.vendido ?? 0;

  return (
    <div className="pantalla pantalla--ancha caja">
      <h1 className="m-titulo">Cierre de caja</h1>
      {error && <Aviso>{error}</Aviso>}
      {!enLinea && (
        <Aviso>
          Sin internet no se ven los totales al día. Las ventas se suben solas cuando vuelva.
        </Aviso>
      )}
      {bandeja.pendientes > 0 && (
        <Aviso tipo="info">
          {bandeja.pendientes} {bandeja.pendientes === 1 ? 'venta esperando' : 'ventas esperando'}{' '}
          para subirse.
        </Aviso>
      )}
      {datos?.turno && (
        <p className="texto-suave">
          Abrió {datos.turno.abiertoPor} a las{' '}
          {new Date(datos.turno.abiertoEn).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      )}
      <p className="caja__vendido">
        Vendiste hoy <strong className="m-plata">{formatearPlata(total)}</strong>
      </p>

      {r && total > 0 && (
        <figure className="barra-medios">
          <div className="barra-medios__barra" aria-hidden="true">
            {MEDIOS.map((m) => {
              const v = r.porMedio[m.clave];
              return v > 0 ? (
                <span
                  key={m.clave}
                  style={{ flexGrow: v, background: m.color }}
                  className={`barra-medios__tramo barra-medios__tramo--${m.clave}`}
                />
              ) : null;
            })}
          </div>
          <figcaption>
            <ul className="leyenda">
              {MEDIOS.map((m) => (
                <li key={m.clave}>
                  <span
                    className={`leyenda__muestra barra-medios__tramo--${m.clave}`}
                    style={{ background: m.color }}
                    aria-hidden="true"
                  />
                  {m.nombre}:{' '}
                  <strong className="m-plata">{formatearPlata(r.porMedio[m.clave])}</strong>
                </li>
              ))}
              {(r.porMedio.cuenta_corriente ?? 0) > 0 && (
                <li>
                  A cuenta (no entra en la caja):{' '}
                  <strong className="m-plata">
                    {formatearPlata(r.porMedio.cuenta_corriente ?? 0)}
                  </strong>
                </li>
              )}
            </ul>
          </figcaption>
        </figure>
      )}

      {r && datos?.turno && (
        <section className="tarjeta-efectivo" aria-label="Efectivo">
          <dl>
            <div>
              <dt>Cambio inicial</dt>
              <dd className="m-plata">{formatearPlata(datos.turno.cambioInicial)}</dd>
            </div>
            <div>
              <dt>+ Ventas en efectivo</dt>
              <dd className="m-plata">{formatearPlata(r.porMedio.efectivo)}</dd>
            </div>
            {(r.cobrosCuenta?.efectivo ?? 0) > 0 && (
              <div>
                <dt>+ Pagos de cuentas en efectivo</dt>
                <dd className="m-plata">{formatearPlata(r.cobrosCuenta?.efectivo ?? 0)}</dd>
              </div>
            )}
            <div>
              <dt>− Gastos y retiros</dt>
              <dd className="m-plata">{formatearPlata(r.gastos + r.retiros)}</dd>
            </div>
            <div className="tarjeta-efectivo__total">
              <dt>Debería haber</dt>
              <dd className="m-plata">{formatearPlata(esperado)}</dd>
            </div>
          </dl>
        </section>
      )}

      <section>
        <h2 className="subtitulo">Gastos y retiros</h2>
        <ul className="lista-filas">
          {datos?.gastos?.map((g) => (
            <li key={g.id} className="tarjeta">
              <span>
                {g.tipo === 'retiro' ? 'Retiro' : 'Gasto'}: {g.motivo}{' '}
                <span className="texto-suave">
                  {new Date(g.created_at).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              <strong className="m-plata">{formatearPlata(g.monto)}</strong>
            </li>
          ))}
        </ul>
        {gasto ? (
          <FormGasto tipo={gasto} alGuardar={guardarGasto} alCancelar={() => setGasto(null)} />
        ) : (
          <div className="acciones">
            <button type="button" className="m-boton" onClick={() => setGasto('gasto')}>
              Anotar un gasto
            </button>
            {s.rol !== 'cajero' && (
              <button type="button" className="m-boton" onClick={() => setGasto('retiro')}>
                Anotar un retiro
              </button>
            )}
          </div>
        )}
      </section>

      <form className="formulario tarjeta-form" onSubmit={cerrar}>
        <CampoPlata
          etiqueta="¿Cuánto contaste?"
          valor={contado}
          alCambiar={setContado}
          error={
            diferencia !== null && diferencia !== 0
              ? diferenciaEnPalabras(contado ?? 0, esperado, formatearPlata) + '.'
              : null
          }
        />
        {diferencia === 0 && <p className="diferencia diferencia--justo">Da justo.</p>}
        {diferencia !== null && diferencia !== 0 && (
          <Campo
            etiqueta="Nota (opcional)"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            placeholder="Por ejemplo: di mal un vuelto"
          />
        )}
        {errorCierre && <Aviso>{errorCierre}</Aviso>}
        <button className="m-boton m-boton--principal" disabled={!enLinea}>
          {enLinea ? 'Cerrar caja' : 'Cerrar caja (necesita internet)'}
        </button>
      </form>

      {s.rol !== 'cajero' && <Pendientes />}
      <VentasDelTurno turnoId={datos?.turno?.id ?? null} />
      {s.rol !== 'cajero' && <CierresAnteriores />}
    </div>
  );
}

function FormGasto({
  tipo,
  alGuardar,
  alCancelar,
}: {
  tipo: 'gasto' | 'retiro';
  alGuardar: (ev: FormEvent<HTMLFormElement>, monto: number | null) => void;
  alCancelar: () => void;
}) {
  const [monto, setMonto] = useState<number | null>(null);
  return (
    <form className="formulario tarjeta-form" onSubmit={(e) => alGuardar(e, monto)}>
      <h3 className="subtitulo">{tipo === 'retiro' ? 'Retiro de plata' : 'Gasto'}</h3>
      <CampoPlata etiqueta="Monto" valor={monto} alCambiar={setMonto} autoFocus />
      <Campo
        etiqueta="Motivo"
        name="motivo"
        required
        maxLength={200}
        placeholder={tipo === 'retiro' ? 'Por ejemplo: lo llevó el dueño' : 'Por ejemplo: bolsas'}
      />
      <div className="acciones">
        <button className="m-boton m-boton--principal">Guardar</button>
        <button type="button" className="m-boton" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function VentasDelTurno({ turnoId }: { turnoId: string | null }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  if (!turnoId) return null;
  return (
    <section>
      <h2 className="subtitulo">Ventas del turno</h2>
      <ListaVentas
        key={version}
        url={`/api/v1/ventas?turnoId=${turnoId}`}
        conResumen={false}
        alAbrir={setAbierta}
      />
      {abierta && (
        <DetalleHistorial
          detalle={{ tipo: 'venta', id: abierta }}
          alCerrar={() => setAbierta(null)}
          alCambiar={() => setVersion((v) => v + 1)}
        />
      )}
    </section>
  );
}

function CierresAnteriores() {
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <section>
      <h2 className="subtitulo">Cierres anteriores</h2>
      <ListaCierres desde={null} alAbrir={setAbierto} />
      <button type="button" className="enlace-boton" onClick={() => navegar('/historial?ver=caja')}>
        Ver todo el historial
      </button>
      {abierto && (
        <DetalleHistorial
          detalle={{ tipo: 'cierre', id: abierto }}
          alCerrar={() => setAbierto(null)}
          alVerVentasDelTurno={(id) => navegar(`/historial?ver=ventas&turno=${id}`)}
        />
      )}
    </section>
  );
}
