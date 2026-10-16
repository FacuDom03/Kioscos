import { DATOS_RUBROS, nombreModulo } from '@mostrador/shared';
import { TEMAS, leerTema } from '@mostrador/ui';
import { api } from '../nucleo/api.ts';
import { hayPendientes, sincronizar, useBandeja } from '../nucleo/bandeja.ts';
import { borrarDatosDelKiosco } from '../nucleo/local.ts';
import { rubroDe, useNegocio } from '../nucleo/rubro.ts';
import { navegar } from '../nucleo/ruta.ts';
import { useSesion, useSesionCompleta } from '../nucleo/sesion.tsx';

interface Opcion {
  ruta: string;
  nombre: string;
  detalle: string;
}

export function Mas() {
  const s = useSesionCompleta();
  const { salir, fijar } = useSesion();
  const tema = TEMAS.find((t) => t.id === leerTema())?.nombre;
  const dueno = s.rol === 'dueno';
  const bandeja = useBandeja();
  const negocio = useNegocio();

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

  const encargado = dueno || s.rol === 'encargado';
  const grupos: { titulo: string; opciones: Opcion[] }[] = [
    {
      titulo: 'Gestión',
      opciones: [
        ...(negocio.tiene('cuenta_corriente')
          ? [
              {
                ruta: '/clientes',
                nombre: nombreModulo(negocio.rubro, 'cuenta_corriente'),
                detalle: 'Clientes, deudas y pagos',
              },
            ]
          : []),
        ...(negocio.tiene('presupuestos')
          ? [
              {
                ruta: '/presupuestos',
                nombre: 'Presupuestos',
                detalle: 'Abiertos, vendidos y vencidos',
              },
            ]
          : []),
        ...(negocio.tiene('promos') && s.rol !== 'cajero'
          ? [{ ruta: '/promos', nombre: 'Promos', detalle: '3x2, segunda unidad y otras' }]
          : []),
        ...(negocio.tiene('regalo')
          ? [{ ruta: '/cambios', nombre: 'Cambios', detalle: 'Con o sin ticket de cambio' }]
          : []),
        ...(encargado
          ? [
              {
                ruta: '/mas/exportar',
                nombre: 'Exportar datos',
                detalle: 'Ventas y compras para el contador',
              },
            ]
          : []),
        ...(dueno
          ? [
              {
                ruta: '/mas/negocio',
                nombre: 'Tu negocio',
                detalle: `${DATOS_RUBROS[rubroDe(s.kiosco.rubro)].nombre}, categorías y funciones`,
              },
              {
                ruta: '/mas/conexiones',
                nombre: 'Conexiones',
                detalle: 'Mercado Pago, copia en la nube y soporte',
              },
            ]
          : []),
      ],
    },
    {
      titulo: 'Personas y seguridad',
      opciones: [
        ...(dueno
          ? [
              {
                ruta: '/mas/usuarios',
                nombre: 'Usuarios',
                detalle: 'Quién atiende y qué puede hacer',
              },
              {
                ruta: '/mas/dispositivos',
                nombre: 'Dispositivos',
                detalle: 'Equipos del local que entran con PIN',
              },
              { ruta: '/mas/actividad', nombre: 'Actividad', detalle: 'Quién hizo qué y cuándo' },
            ]
          : []),
        ...(!s.esSoporte && encargado
          ? [
              {
                ruta: '/mas/seguridad',
                nombre: 'Seguridad',
                detalle: 'Contraseña y segundo factor',
              },
            ]
          : []),
      ],
    },
    {
      titulo: 'Este equipo',
      opciones: [
        { ruta: '/mas/equipo', nombre: 'Este equipo', detalle: 'Impresora y balanza' },
        {
          ruta: '/mas/apariencia',
          nombre: 'Apariencia',
          detalle: tema ?? 'Colores de la pantalla',
        },
      ],
    },
  ];

  return (
    <div className="pantalla mas">
      <header className="mas__cabeza">
        <h1 className="m-titulo">Más</h1>
        <p className="texto-suave">
          {s.usuario.nombre} · {s.kiosco.nombre}
        </p>
      </header>
      {grupos
        .filter((g) => g.opciones.length > 0)
        .map((g) => (
          <section key={g.titulo} className="mas__grupo" aria-label={g.titulo}>
            <h2 className="subtitulo">{g.titulo}</h2>
            <ul className="opciones-mas">
              {g.opciones.map((o) => (
                <li key={o.ruta}>
                  <button type="button" className="opcion-mas" onClick={() => navegar(o.ruta)}>
                    <span className="opcion-mas__texto">
                      <span className="opcion-mas__nombre">{o.nombre}</span>
                      <span className="texto-suave">{o.detalle}</span>
                    </span>
                    <span aria-hidden="true" className="opcion-mas__flecha">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {s.kioscos.length > 1 && (
        <section className="mas__grupo">
          <h2 className="subtitulo">Cambiar de kiosco</h2>
          <ul className="opciones-mas">
            {s.kioscos
              .filter((k) => k.id !== s.kiosco.id)
              .map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className="opcion-mas"
                    onClick={async () => {
                      fijar(await api('POST', '/api/v1/auth/kiosco', { kioscoId: k.id }));
                      navegar('/');
                    }}
                  >
                    <span className="opcion-mas__nombre">{k.nombre}</span>
                    <span aria-hidden="true" className="opcion-mas__flecha">
                      ›
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      <button type="button" className="m-boton mas__salir" onClick={() => void cerrarSesion()}>
        Cerrar sesión
      </button>
    </div>
  );
}
