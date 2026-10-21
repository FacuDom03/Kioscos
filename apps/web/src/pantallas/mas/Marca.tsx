import { useRef, useState, type FormEvent } from 'react';
import { confirmar } from '../../componentes/Dialogos.tsx';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { urlLogo, useMarca, type Marca as DatosMarca } from '../../componentes/Marca.tsx';
import { ErrorApi, api, mensajeDeError } from '../../nucleo/api.ts';
import { useSesion, useSesionCompleta } from '../../nucleo/sesion.tsx';

// Logo y texto al pie de lo que se imprime (tickets, facturas, remitos y presupuestos), y marca
// de agua en los presupuestos. Lo configura el dueño.

const MAXIMO = 150 * 1024;
// Ancho de una impresora térmica de 58 mm (384 puntos): más grande no se ve mejor.
const ANCHO = 384;
const ALTO = 192;

/** Achica la imagen en el equipo y la devuelve en base64 (PNG, o JPG si queda pesada). */
async function achicarLogo(archivo: File): Promise<string> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, ANCHO / imagen.width, ALTO / imagen.height);
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No se pudo leer la imagen.');
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  const aBlob = (tipo: string, calidad?: number) =>
    new Promise<Blob | null>((ok) => lienzo.toBlob(ok, tipo, calidad));
  let blob = await aBlob('image/png');
  if (!blob || blob.size > MAXIMO) {
    // JPG no tiene transparencia: fondo blanco, como el papel.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    blob = await aBlob('image/jpeg', 0.85);
  }
  if (!blob || blob.size > MAXIMO) throw new Error('La imagen es muy pesada. Probá con otra.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

export function Marca({ alVolver }: { alVolver: () => void }) {
  const s = useSesionCompleta();
  const { recargar } = useSesion();
  const marca: DatosMarca = useMarca() ?? {
    logo: null,
    logoEnTicket: true,
    marcaAgua: false,
    pie: null,
  };
  const archivo = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function subir(f: File | undefined) {
    if (!f) return;
    setSubiendo(true);
    setAviso(null);
    try {
      const datos = await achicarLogo(f);
      await api('PUT', '/api/v1/personalizacion/logo', { datos });
      await recargar();
      setAviso({ tipo: 'ok', texto: 'Listo: el logo sale en lo que imprimas.' });
    } catch (e) {
      // Los errores al achicar la imagen ya vienen en palabras.
      setAviso({
        tipo: 'error',
        texto: e instanceof Error && !(e instanceof ErrorApi) ? e.message : mensajeDeError(e),
      });
    } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = '';
    }
  }

  async function quitar() {
    if (
      !(await confirmar({
        titulo: '¿Quitar el logo?',
        texto: 'Los tickets y presupuestos salen sin logo.',
        aceptar: 'Quitar logo',
        peligro: true,
      }))
    )
      return;
    try {
      await api('DELETE', '/api/v1/personalizacion/logo');
      await recargar();
      setAviso(null);
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    }
  }

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      await api('PUT', '/api/v1/personalizacion', {
        pie: String(f.get('pie') ?? '').trim() || null,
        logoEnTicket: f.get('logoEnTicket') === 'on',
        marcaAgua: f.get('marcaAgua') === 'on',
      });
      await recargar();
      setAviso({ tipo: 'ok', texto: 'Guardado.' });
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDeError(e) });
    }
  }

  return (
    <div className="pantalla marca">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Logo y tickets</h1>
      <p className="texto-suave">
        Tu logo y un texto al pie en los tickets, facturas, remitos y presupuestos.
      </p>

      <div className="marca__grilla">
        <section className="conexion" aria-labelledby="titulo-logo">
          <h2 id="titulo-logo" className="subtitulo">
            Logo
          </h2>
          {marca.logo ? (
            <img
              className="marca__logo"
              src={urlLogo(marca.logo)}
              alt={`Logo de ${s.kiosco.nombre}`}
            />
          ) : (
            <p className="texto-suave">Todavía no cargaste un logo.</p>
          )}
          <p className="texto-suave">
            PNG o JPG. Se achica solo al tamaño del ticket. En la impresora térmica sale en blanco y
            negro: los logos simples y con buen contraste se ven mejor.
          </p>
          <input
            ref={archivo}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => void subir(e.target.files?.[0])}
          />
          <div className="acciones">
            <button
              type="button"
              className={marca.logo ? 'm-boton' : 'm-boton m-boton--accion'}
              disabled={subiendo}
              aria-busy={subiendo}
              onClick={() => archivo.current?.click()}
            >
              {subiendo ? 'Subiendo…' : marca.logo ? 'Cambiar logo' : 'Subir logo'}
            </button>
            {marca.logo && (
              <button type="button" className="m-boton" onClick={() => void quitar()}>
                Quitar logo
              </button>
            )}
          </div>
        </section>

        <form className="conexion formulario" onSubmit={guardar} aria-labelledby="titulo-tickets">
          <h2 id="titulo-tickets" className="subtitulo">
            Qué sale impreso
          </h2>
          <label className="opcion opcion--check">
            <input type="checkbox" name="logoEnTicket" defaultChecked={marca.logoEnTicket} /> Poner
            el logo arriba de los tickets y facturas
          </label>
          <label className="opcion opcion--check">
            <input type="checkbox" name="marcaAgua" defaultChecked={marca.marcaAgua} /> Marca de
            agua con el logo en los presupuestos (en hoja)
          </label>
          <div className="campo">
            <label htmlFor="pie-ticket">Texto al pie (opcional)</label>
            <textarea
              id="pie-ticket"
              name="pie"
              className="campo__entrada"
              rows={3}
              maxLength={200}
              defaultValue={marca.pie ?? ''}
              placeholder="¡Gracias por tu compra! Seguinos en Instagram @tunegocio"
              aria-describedby="pie-ayuda"
            />
            <p id="pie-ayuda" className="campo__ayuda">
              Hasta 200 letras. Sale al final del ticket, la factura y el presupuesto.
            </p>
          </div>
          <div className="acciones">
            <button className="m-boton m-boton--principal">Guardar</button>
          </div>
        </form>

        <section className="conexion" aria-labelledby="titulo-muestra">
          <h2 id="titulo-muestra" className="subtitulo">
            Así se ve el ticket
          </h2>
          <div className="marca__muestra">
            {marca.logo && marca.logoEnTicket && (
              <img className="marca__muestra-logo" src={urlLogo(marca.logo)} alt="" />
            )}
            <p className="marca__muestra-nombre">{s.kiosco.nombre}</p>
            <p>1 Alfajor triple ........ $ 1.500</p>
            <p>
              <strong>TOTAL $ 1.500</strong>
            </p>
            {marca.pie && <p className="marca__muestra-pie">{marca.pie}</p>}
          </div>
        </section>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  );
}
