import { TEMAS, leerTema } from '@mostrador/ui';
import { api } from '../nucleo/api.ts';
import { hayPendientes, sincronizar, useBandeja } from '../nucleo/bandeja.ts';
import { borrarDatosDelKiosco } from '../nucleo/local.ts';
import { navegar } from '../nucleo/ruta.ts';
import { useSesion, useSesionCompleta } from '../nucleo/sesion.tsx';

interface Opcion {
  ruta: string;
  nombre: string;
  detalle?: string;
}

export function Mas() {
  const s = useSesionCompleta();
  const { salir, fijar } = useSesion();
  const tema = TEMAS.find((t) => t.id === leerTema())?.nombre;
  const dueno = s.rol === 'dueno';
  const bandeja = useBandeja();

  // Al cerrar sesión se borran los datos del kiosco en el equipo, salvo las ventas sin subir:
  // con ventas pendientes no se deja cerrar.
  async function cerrarSesion() {
    if (hayPendientes() && !(await sincronizar())) {
      alert(
        `Tenés ${bandeja.pendientes} ventas sin subir. Esperá a que vuelva internet para cerrar la sesión.`,
      );
      return;
    }
    await borrarDatosDelKiosco(s.kiosco.id);
    await salir();
  }

  const opciones: Opcion[] = [
    ...(dueno
      ? [
          {
            ruta: '/mas/conexiones',
            nombre: 'Conexiones',
            detalle: 'Mercado Pago, copia en la nube y soporte',
          },
        ]
      : []),
    ...(dueno
      ? [
          { ruta: '/mas/usuarios', nombre: 'Usuarios' },
          { ruta: '/mas/dispositivos', nombre: 'Dispositivos' },
        ]
      : []),
    ...(s.rol === 'dueno' || s.rol === 'encargado'
      ? [
          {
            ruta: '/mas/exportar',
            nombre: 'Exportar datos',
            detalle: 'Ventas y compras para el contador',
          },
        ]
      : []),
    ...(dueno ? [{ ruta: '/mas/actividad', nombre: 'Actividad' }] : []),
    ...(!s.esSoporte && (s.rol === 'dueno' || s.rol === 'encargado')
      ? [{ ruta: '/mas/seguridad', nombre: 'Seguridad' }]
      : []),
    { ruta: '/mas/equipo', nombre: 'Este equipo', detalle: 'Impresora y balanza' },
    { ruta: '/mas/apariencia', nombre: 'Apariencia', ...(tema ? { detalle: tema } : {}) },
  ];

  return (
    <div className="pantalla">
      <h1 className="m-titulo">Más</h1>
      <p className="texto-suave">
        {s.usuario.nombre} · {s.kiosco.nombre}
      </p>
      <ul className="lista-filas">
        {opciones.map((o) => (
          <li key={o.ruta}>
            <button type="button" className="fila" onClick={() => navegar(o.ruta)}>
              <span>{o.nombre}</span>
              <span className="texto-suave">
                {o.detalle} <span aria-hidden="true">›</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {s.kioscos.length > 1 && (
        <section>
          <h2 className="subtitulo">Cambiar de kiosco</h2>
          <ul className="lista-filas">
            {s.kioscos
              .filter((k) => k.id !== s.kiosco.id)
              .map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className="fila"
                    onClick={async () => {
                      fijar(await api('POST', '/api/v1/auth/kiosco', { kioscoId: k.id }));
                      navegar('/');
                    }}
                  >
                    {k.nombre}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      <button type="button" className="m-boton" onClick={() => void cerrarSesion()}>
        Cerrar sesión
      </button>
    </div>
  );
}
