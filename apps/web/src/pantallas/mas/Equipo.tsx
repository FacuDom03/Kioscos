import { Volver } from '../../componentes/Formulario.tsx';
import { guardarEquipo, useEquipo } from '../../nucleo/equipo.ts';

export function Equipo({ alVolver }: { alVolver: () => void }) {
  const c = useEquipo();
  return (
    <div className="pantalla">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Este equipo</h1>
      <p className="texto-suave">Esto se guarda solo en este equipo.</p>

      <section className="tarjeta-form">
        <h2 className="subtitulo">Impresora de tickets</h2>
        <fieldset className="campo">
          <legend>Ancho del papel</legend>
          <div className="chips">
            {(['58', '80'] as const).map((a) => (
              <label key={a} className="chip chip--radio">
                <input
                  type="radio"
                  name="ancho"
                  checked={c.anchoTicket === a}
                  onChange={() => guardarEquipo({ ...c, anchoTicket: a })}
                />
                {a} mm
              </label>
            ))}
          </div>
        </fieldset>
        <label className="opcion">
          <input
            type="checkbox"
            checked={c.imprimirAlCobrar}
            onChange={(e) => guardarEquipo({ ...c, imprimirAlCobrar: e.target.checked })}
          />
          Imprimir el ticket cada vez que se cobra
        </label>
        <details>
          <summary>Cómo dejar la impresora lista</summary>
          <ol className="ayuda">
            <li>Conectá la impresora térmica e instalá su programa (viene con la impresora).</li>
            <li>
              En Windows: Configuración → Bluetooth y dispositivos → Impresoras. Elegí la térmica y
              tocá "Establecer como predeterminada".
            </li>
            <li>
              La primera vez que imprimas, en el diálogo elegí la térmica, márgenes "Ninguno" y sacá
              "Encabezados y pies de página".
            </li>
            <li>
              Para imprimir sin que aparezca el diálogo: hacé un acceso directo de Chrome o Edge y
              agregale al final <code>--kiosk-printing</code>.
            </li>
          </ol>
        </details>
      </section>

      <section className="tarjeta-form">
        <h2 className="subtitulo">Balanza</h2>
        <label className="opcion">
          <input
            type="checkbox"
            checked={c.balanza.activa}
            onChange={(e) =>
              guardarEquipo({ ...c, balanza: { ...c.balanza, activa: e.target.checked } })
            }
          />
          Leer etiquetas de balanza (códigos que empiezan con 20 a 29)
        </label>
        {c.balanza.activa && (
          <>
            <fieldset className="campo">
              <legend>La etiqueta trae</legend>
              <div className="chips">
                <label className="chip chip--radio">
                  <input
                    type="radio"
                    name="valor"
                    checked={c.balanza.valor === 'precio'}
                    onChange={() =>
                      guardarEquipo({ ...c, balanza: { ...c.balanza, valor: 'precio' } })
                    }
                  />
                  El precio
                </label>
                <label className="chip chip--radio">
                  <input
                    type="radio"
                    name="valor"
                    checked={c.balanza.valor === 'peso'}
                    onChange={() =>
                      guardarEquipo({ ...c, balanza: { ...c.balanza, valor: 'peso' } })
                    }
                  />
                  El peso
                </label>
              </div>
            </fieldset>
            {c.balanza.valor === 'precio' && (
              <div className="campo">
                <label htmlFor="decimales">El precio de la etiqueta está en</label>
                <select
                  id="decimales"
                  className="campo__entrada"
                  value={c.balanza.decimalesPrecio}
                  onChange={(e) =>
                    guardarEquipo({
                      ...c,
                      balanza: { ...c.balanza, decimalesPrecio: Number(e.target.value) as 0 },
                    })
                  }
                >
                  <option value={0}>Pesos (por ejemplo 01500 = $ 1.500)</option>
                  <option value={1}>Pesos con un decimal (01500 = $ 150)</option>
                  <option value={2}>Centavos (01500 = $ 15)</option>
                </select>
              </div>
            )}
            <p className="texto-suave">
              El código de producto de la etiqueta (5 números) tiene que estar cargado como código
              en el producto, por ejemplo "00123".
            </p>
          </>
        )}
      </section>

      <section className="tarjeta-form">
        <h2 className="subtitulo">Lector de códigos</h2>
        <p className="texto-suave">
          Los lectores USB o Bluetooth funcionan solos: escaneá en la pantalla de venta y el
          producto se suma al ticket, aunque no estés en el buscador.
        </p>
      </section>
    </div>
  );
}
