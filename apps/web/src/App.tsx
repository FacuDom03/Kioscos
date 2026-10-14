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
import { Proximamente } from './pantallas/Proximamente.tsx';
import { Vender } from './pantallas/Vender.tsx';
import { AumentoPrecios } from './pantallas/stock/Aumento.tsx';
import { CargarCompra } from './pantallas/stock/CargarCompra.tsx';
import { ImportarProductos } from './pantallas/stock/Importar.tsx';
import { ProductoPantalla } from './pantallas/stock/Producto.tsx';
import { Stock } from './pantallas/stock/Stock.tsx';

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
  useEffect(() => {
    const parar = iniciarRefrescoCatalogo();
    return () => {
      parar();
      olvidarCatalogo();
    };
  }, []);
  const seccion: Seccion = SECCION_DE_RUTA.find(([p]) => ruta.startsWith(p))?.[1] ?? 'vender';
  const estadoConexion = <span className="m-estado">En línea</span>;
  const volverAMas = () => navegar('/mas');

  let pantalla;
  const producto = /^\/stock\/producto\/([0-9a-f-]{36})$/.exec(ruta);
  switch (producto ? '/stock/producto/:id' : ruta) {
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
      pantalla = <Proximamente titulo="Caja" />;
      break;
    case '/mas':
      pantalla = <Mas />;
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
        {pantalla}
      </Marco>
    </>
  );
}
