import { Marco, type Seccion } from '@mostrador/ui';
import { iniciarRefrescoCatalogo, olvidarCatalogo } from './nucleo/catalogo.ts';
import { useEffect, useState } from 'react';
import { api } from './nucleo/api.ts';
import { navegar, useRuta } from './nucleo/ruta.ts';
import { ProveedorSesion, useSesion } from './nucleo/sesion.tsx';
import { CodigosRecuperacion, ConfigurarSegundoFactor } from './pantallas/acceso/Configurar.tsx';
import { Ingresar } from './pantallas/acceso/Ingresar.tsx';
import { Invitacion } from './pantallas/acceso/Invitacion.tsx';
import { IngresoPin, type PersonasEquipo } from './pantallas/acceso/Pin.tsx';
import { SegundoFactor } from './pantallas/acceso/SegundoFactor.tsx';
import { EntradaSoporte } from './pantallas/acceso/Soporte.tsx';
import { Apariencia } from './pantallas/Apariencia.tsx';
import { Mas } from './pantallas/Mas.tsx';
import { Auditoria } from './pantallas/mas/Auditoria.tsx';
import { Conexiones } from './pantallas/mas/Conexiones.tsx';
import { Dispositivos } from './pantallas/mas/Dispositivos.tsx';
import { Seguridad } from './pantallas/mas/Seguridad.tsx';
import { Usuarios } from './pantallas/mas/Usuarios.tsx';
import { Vender } from './pantallas/vender/Vender.tsx';
import { Caja } from './pantallas/caja/Caja.tsx';
import { BannerConexion } from './componentes/BannerConexion.tsx';
import { BannerVersion } from './componentes/BannerVersion.tsx';
import { Bloqueo } from './componentes/Bloqueo.tsx';
import { usarKiosco } from './nucleo/bandeja.ts';
import { cargarTicket } from './nucleo/ticket.ts';
import { cargarTurno } from './nucleo/turno.ts';
import { useEnLinea } from './nucleo/conexion.ts';
import { refrescarMp } from './nucleo/mp.ts';
import { iniciarLector } from './nucleo/lector.ts';
import { Equipo } from './pantallas/mas/Equipo.tsx';
import { ArmarNegocio } from './pantallas/negocio/ArmarNegocio.tsx';
import { aplicarRubro, rubroDe } from './nucleo/rubro.ts';
import { Exportar } from './pantallas/mas/Exportar.tsx';
import { AumentoPrecios } from './pantallas/stock/Aumento.tsx';
import { CargarCompra } from './pantallas/stock/CargarCompra.tsx';
import { ImportarProductos } from './pantallas/stock/Importar.tsx';
import { ProductoPantalla } from './pantallas/stock/Producto.tsx';
import { Stock } from './pantallas/stock/Stock.tsx';
import { ListaProveedor } from './pantallas/stock/ListaProveedor.tsx';
import { Proveedores } from './pantallas/stock/Proveedores.tsx';
import { PresupuestoPantalla } from './pantallas/presupuestos/Presupuesto.tsx';
import { Presupuestos } from './pantallas/presupuestos/Presupuestos.tsx';
import { ClientePantalla } from './pantallas/clientes/Cliente.tsx';
import { Clientes } from './pantallas/clientes/Clientes.tsx';
import { Tablero } from './pantallas/tablero/Tablero.tsx';

export function App() {
  return (
    <ProveedorSesion>
      <Raiz />
    </ProveedorSesion>
  );
}

function Raiz() {
  const ruta = useRuta();
  const { estado, recargar } = useSesion();
  const [codigos, setCodigos] = useState<string[] | null>(null);

  if (ruta === '/invitacion') return <Invitacion />;
  if (ruta === '/soporte') return <EntradaSoporte />;

  if (estado.tipo === 'cargando') return <div className="cargando" aria-busy="true" />;
  if (estado.tipo === 'sin_sesion') return <SinSesion />;
  if (estado.tipo === 'pendiente_2fa') {
    if (estado.paso === 'segundo_factor') return <SegundoFactor sesion={estado} />;
    return (
      <ConfigurarSegundoFactor
        alTerminar={(r) => {
          setCodigos(r.codigosRecuperacion);
          void recargar();
        }}
      />
    );
  }
  if (codigos?.length)
    return <CodigosRecuperacion codigos={codigos} alTerminar={() => setCodigos(null)} />;
  // Primera vez del dueño: confirma el rubro y arma el negocio antes de empezar.
  if (estado.rol === 'dueno' && !estado.esSoporte && estado.kiosco.configurado === false)
    return <ArmarNegocio />;
  return <AppConSesion ruta={ruta} />;
}

function SinSesion() {
  const [equipo, setEquipo] = useState<PersonasEquipo | null>(null);
  const [conEmail, setConEmail] = useState(false);
  useEffect(() => {
    api<PersonasEquipo>('GET', '/api/v1/auth/pin/personas')
      .then(setEquipo)
      .catch(() => setEquipo({ dispositivo: null, personas: [] }));
  }, []);
  if (!equipo) return <div className="cargando" aria-busy="true" />;
  if (equipo.personas.length > 0 && !conEmail)
    return <IngresoPin equipo={equipo} alUsarEmail={() => setConEmail(true)} />;
  return <Ingresar alUsarPin={equipo.personas.length > 0 ? () => setConEmail(false) : undefined} />;
}

const SECCION_DE_RUTA: [string, Seccion][] = [
  ['/stock', 'stock'],
  ['/caja', 'caja'],
  ['/mas', 'mas'],
];

function AppConSesion({ ruta }: { ruta: string }) {
  const { estado } = useSesion();
  const kioscoId = estado.tipo === 'completa' ? estado.kiosco.id : null;
  const rubro = rubroDe(estado.tipo === 'completa' ? estado.kiosco.rubro : null);
  const enLinea = useEnLinea();
  useEffect(() => aplicarRubro(rubro), [rubro]);
  useEffect(() => {
    if (!kioscoId) return;
    usarKiosco(kioscoId);
    void cargarTurno(kioscoId);
    void cargarTicket(kioscoId);
    void refrescarMp();
    const parar = iniciarRefrescoCatalogo(kioscoId);
    const pararLector = iniciarLector();
    return () => {
      parar();
      pararLector();
      olvidarCatalogo();
      usarKiosco(null);
    };
  }, [kioscoId]);
  const seccion: Seccion = SECCION_DE_RUTA.find(([p]) => ruta.startsWith(p))?.[1] ?? 'vender';
  const estadoConexion = enLinea ? (
    <span className="m-estado">En línea</span>
  ) : (
    <span className="m-estado m-estado--sin-conexion">Sin internet</span>
  );
  const volverAMas = () => navegar('/mas');

  let pantalla;
  const producto = /^\/stock\/producto\/([0-9a-f-]{36})$/.exec(ruta);
  const listaProveedor = /^\/stock\/proveedores\/([0-9a-f-]{36})\/lista$/.exec(ruta);
  const presupuesto = /^\/presupuestos\/([0-9a-f-]{36})$/.exec(ruta);
  const cliente = /^\/clientes\/([0-9a-f-]{36})$/.exec(ruta);
  switch (
    producto
      ? '/stock/producto/:id'
      : listaProveedor
        ? '/stock/proveedores/:id/lista'
        : presupuesto
          ? '/presupuestos/:id'
          : cliente
            ? '/clientes/:id'
            : ruta
  ) {
    case '/tablero':
      pantalla = <Tablero alVolver={volverAMas} />;
      break;
    case '/clientes':
      pantalla = <Clientes alVolver={volverAMas} />;
      break;
    case '/clientes/:id':
      pantalla = <ClientePantalla key={cliente?.[1]} id={cliente?.[1] ?? ''} />;
      break;
    case '/presupuestos':
      pantalla = <Presupuestos alVolver={() => navegar('/')} />;
      break;
    case '/presupuestos/:id':
      pantalla = <PresupuestoPantalla key={presupuesto?.[1]} id={presupuesto?.[1] ?? ''} />;
      break;
    case '/stock/proveedores':
      pantalla = <Proveedores />;
      break;
    case '/stock/proveedores/:id/lista':
      pantalla = <ListaProveedor key={listaProveedor?.[1]} id={listaProveedor?.[1] ?? ''} />;
      break;
    case '/stock':
      pantalla = <Stock />;
      break;
    case '/stock/producto/nuevo':
      pantalla = (
        <ProductoPantalla
          id={null}
          codigoInicial={new URLSearchParams(location.search).get('codigo')}
        />
      );
      break;
    case '/stock/producto/:id':
      pantalla = <ProductoPantalla key={producto?.[1]} id={producto?.[1] ?? null} />;
      break;
    case '/stock/compra':
      pantalla = <CargarCompra />;
      break;
    case '/stock/aumento':
      pantalla = <AumentoPrecios />;
      break;
    case '/stock/importar':
      pantalla = <ImportarProductos />;
      break;
    case '/caja':
      pantalla = <Caja />;
      break;
    case '/mas':
      pantalla = <Mas />;
      break;
    case '/mas/negocio':
      pantalla = <ArmarNegocio alVolver={volverAMas} />;
      break;
    case '/mas/apariencia':
      pantalla = <Apariencia alVolver={volverAMas} />;
      break;
    case '/mas/usuarios':
      pantalla = <Usuarios alVolver={volverAMas} />;
      break;
    case '/mas/dispositivos':
      pantalla = <Dispositivos alVolver={volverAMas} />;
      break;
    case '/mas/seguridad':
      pantalla = <Seguridad alVolver={volverAMas} />;
      break;
    case '/mas/actividad':
      pantalla = <Auditoria alVolver={volverAMas} />;
      break;
    case '/mas/exportar':
      pantalla = <Exportar alVolver={volverAMas} />;
      break;
    case '/mas/equipo':
      pantalla = <Equipo alVolver={volverAMas} />;
      break;
    case '/mas/conexiones':
      pantalla = (
        <Conexiones alVolver={volverAMas} alAbrirApariencia={() => navegar('/mas/apariencia')} />
      );
      break;
    default:
      pantalla = <Vender estado={estadoConexion} />;
  }

  return (
    <>
      {estado.tipo === 'completa' && estado.esSoporte && (
        <p className="banda-soporte" role="status">
          Estás como soporte en {estado.kiosco.nombre}. Todo queda registrado.
        </p>
      )}
      <Marco
        seccion={seccion}
        alCambiar={(s) => navegar(s === 'vender' ? '/' : `/${s}`)}
        estado={estadoConexion}
      >
        <BannerConexion />
        <BannerVersion />
        {pantalla}
      </Marco>
      {estado.tipo === 'completa' && estado.rol === 'cajero' && (
        <Bloqueo kioscoId={estado.kiosco.id} nombre={estado.usuario.nombre} />
      )}
    </>
  );
}
