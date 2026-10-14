import { useEffect, useState } from 'react';
import { eventosBandeja, useBandeja } from '../nucleo/bandeja.ts';
import { useEnLinea } from '../nucleo/conexion.ts';

/** Estado de conexión siempre visible y en palabras (sección 12). */
export function BannerConexion() {
  const enLinea = useEnLinea();
  const { pendientes, rechazadas } = useBandeja();
  const [subidas, setSubidas] = useState<number | null>(null);
  const [avisoStock, setAvisoStock] = useState<string | null>(null);

  useEffect(() => {
    let cuenta = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const alSubir = () => {
      cuenta++;
      if (!navigator.onLine) return;
      setSubidas(cuenta);
      clearTimeout(t);
      t = setTimeout(() => {
        setSubidas(null);
        cuenta = 0;
      }, 6000);
    };
    const alNegativo = (e: Event) => {
      const avisos = (e as CustomEvent<{ nombre: string; stock: number }[]>).detail;
      setAvisoStock(
        `Ojo: quedó stock negativo en ${avisos.map((a) => `${a.nombre} (${a.stock})`).join(', ')}. Revisalo en Stock.`,
      );
    };
    eventosBandeja.addEventListener('subida', alSubir);
    eventosBandeja.addEventListener('stock-negativo', alNegativo);
    return () => {
      eventosBandeja.removeEventListener('subida', alSubir);
      eventosBandeja.removeEventListener('stock-negativo', alNegativo);
      clearTimeout(t);
    };
  }, []);

  return (
    <div className="banners" aria-live="polite">
      {!enLinea && (
        <p className="banner banner--sin-conexion" role="status">
          <span>Sin internet. Seguí vendiendo, las ventas se suben solas cuando vuelva.</span>
          {pendientes > 0 && (
            <span className="banner__pastilla">
              {pendientes} {pendientes === 1 ? 'venta esperando' : 'ventas esperando'}
            </span>
          )}
        </p>
      )}
      {enLinea && subidas !== null && subidas > 1 && (
        <p className="banner banner--ok" role="status">
          Listo, se subieron {subidas} ventas.
        </p>
      )}
      {rechazadas > 0 && (
        <p className="banner banner--error" role="alert">
          {rechazadas === 1
            ? 'Una venta no se pudo guardar.'
            : `${rechazadas} ventas no se pudieron guardar.`}{' '}
          No se perdió: avisanos por WhatsApp.
        </p>
      )}
      {avisoStock && (
        <p className="banner banner--aviso" role="status">
          {avisoStock}{' '}
          <button type="button" className="enlace-boton" onClick={() => setAvisoStock(null)}>
            Cerrar
          </button>
        </p>
      )}
    </div>
  );
}
