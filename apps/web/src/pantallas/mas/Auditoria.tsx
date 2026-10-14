import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Fila {
  id: string;
  accion: string;
  es_soporte: boolean;
  created_at: string;
  nombre: string | null;
}

// Descripciones en palabras de cada acción auditada.
const ACCIONES: Record<string, string> = {
  'sesion.inicio': 'Entró con email',
  'sesion.pin': 'Entró con PIN',
  'dispositivo.alta': 'Autorizó un equipo',
  'dispositivo.baja': 'Quitó un equipo',
  'usuario.alta': 'Agregó un cajero',
  'usuario.pin': 'Cambió un PIN',
  'usuario.baja': 'Desactivó un usuario',
  'usuario.reactivado': 'Reactivó un usuario',
  'usuario.invitacion': 'Invitó a un encargado',
  'usuario.invitacion_cancelada': 'Canceló una invitación',
  'invitacion.aceptada': 'Aceptó la invitación',
  'soporte.activado': 'Activó el acceso de soporte',
  'soporte.desactivado': 'Apagó el acceso de soporte',
  'soporte.entrada': 'Soporte entró',
  'soporte.accion': 'Soporte hizo un cambio',
  'cuenta.password': 'Cambió la contraseña',
  'cuenta.codigos': 'Generó códigos de recuperación',
  'cuenta.segundo_factor': 'Agregó un segundo paso de ingreso',
  'cuenta.passkey_borrada': 'Borró una passkey',
  'precios.aumento': 'Aplicó un aumento de precios',
  'precios.deshacer': 'Deshizo un aumento de precios',
  'venta.anulada': 'Anuló una venta',
  'venta.devuelta': 'Marcó una devolución como hecha',
  'exportacion.csv': 'Exportó datos',
  'mp.conectado': 'Conectó Mercado Pago',
  'mp.desconectado': 'Desconectó Mercado Pago',
  'kiosco.alta': 'Se creó la cuenta',
  'kiosco.plan': 'Cambió el plan',
};

export function Auditoria({ alVolver }: { alVolver: () => void }) {
  const { datos, error } = useDatos<Fila[]>('/api/v1/auditoria');
  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Actividad</h1>
      <p className="texto-suave">
        Quién hizo qué en el kiosco. Lo que hace soporte aparece marcado.
      </p>
      {error && <Aviso>{error}</Aviso>}
      <ul className="lista-filas">
        {datos?.map((f) => (
          <li key={f.id} className="tarjeta">
            <div>
              <strong>{ACCIONES[f.accion] ?? f.accion}</strong>
              {f.es_soporte && <span className="etiqueta-soporte">Soporte</span>}
              <p className="texto-suave">
                {f.nombre || 'Sistema'} · {new Date(f.created_at).toLocaleString('es-AR')}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
