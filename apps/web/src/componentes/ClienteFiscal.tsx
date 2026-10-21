// Datos para facturarle a un cliente a su nombre, como en Odoo: CUIT o DNI, nombre, condición
// frente al IVA y domicilio. Con el CUIT, "Buscar en ARCA" completa todo (sin tipear ni errores).
import { cuitValido } from '@mostrador/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, mensajeDeError } from '../nucleo/api.ts';
import { useEnLinea } from '../nucleo/conexion.ts';
import type { CompradorElegido } from '../nucleo/ticket.ts';
import { Aviso, Campo } from './Formulario.tsx';

export type CondicionIva = CompradorElegido['condicion'];
export type TipoDocumento = CompradorElegido['documento']['tipo'];

export const CONDICIONES_IVA: Record<CondicionIva, string> = {
  consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo',
  responsable_inscripto: 'Responsable inscripto',
  exento: 'Exento',
};

/** "CUIT 20-11111111-2" o "DNI 30123456". */
export function documentoVisible(tipo: TipoDocumento, numero: string): string {
  if (tipo === 'dni') return `DNI ${numero}`;
  return `${tipo.toUpperCase()} ${numero.slice(0, 2)}-${numero.slice(2, 10)}-${numero.slice(10)}`;
}

export interface DatosFiscalesCliente {
  nombre: string;
  doc_tipo: TipoDocumento | null;
  doc_nro: string | null;
  condicion_iva: CondicionIva | null;
  domicilio: string | null;
}

interface Persona {
  nombre: string;
  condicion: CondicionIva;
  domicilio: string | null;
  activa: boolean;
}

export function FormClienteFiscal({
  clienteId,
  inicial,
  textoGuardar = 'Guardar',
  alGuardar,
  alCancelar,
}: {
  /** Para editar un cliente que ya existe; sin esto, se crea uno nuevo. */
  clienteId?: string;
  inicial?: DatosFiscalesCliente | null;
  textoGuardar?: string;
  alGuardar: (c: CompradorElegido & { domicilio: string | null }) => void;
  alCancelar?: () => void;
}) {
  const enLinea = useEnLinea();
  const [tipo, setTipo] = useState<'cuit' | 'dni'>(inicial?.doc_tipo === 'dni' ? 'dni' : 'cuit');
  const [numero, setNumero] = useState(inicial?.doc_nro ?? '');
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [condicion, setCondicion] = useState<CondicionIva>(
    inicial?.condicion_iva ?? 'consumidor_final',
  );
  const [domicilio, setDomicilio] = useState(inicial?.domicilio ?? '');
  const [buscando, setBuscando] = useState(false);
  const [deArca, setDeArca] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Al editar, lo que ya estaba guardado no se vuelve a buscar solo.
  const buscado = useRef<string | null>(clienteId ? (inicial?.doc_nro ?? null) : null);

  const limpio = numero.replace(/\D/g, '');
  const cuitListo = tipo === 'cuit' && limpio.length === 11 && cuitValido(limpio);
  const errorNumero =
    tipo === 'cuit' && limpio.length === 11 && !cuitValido(limpio)
      ? 'Revisá el CUIT: el último número no coincide.'
      : null;

  async function buscar(cuit: string) {
    buscado.current = cuit;
    setBuscando(true);
    setError(null);
    setDeArca(null);
    try {
      const p = await api<Persona>('POST', '/api/v1/facturacion/padron', { cuit });
      setNombre(p.nombre);
      setCondicion(p.condicion);
      setDomicilio(p.domicilio ?? '');
      setDeArca(
        p.activa
          ? 'Datos de ARCA. Revisalos y guardá.'
          : 'Datos de ARCA. Ojo: la clave fiscal de este CUIT no está activa.',
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setBuscando(false);
    }
  }

  // Apenas se completa un CUIT válido, se busca solo (una vez por número).
  useEffect(() => {
    if (cuitListo && enLinea && buscado.current !== limpio) void buscar(limpio);
  }, [cuitListo, enLinea, limpio]);

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (tipo === 'cuit' && !cuitValido(limpio)) {
      setError('Revisá el CUIT: son 11 números.');
      return;
    }
    if (tipo === 'dni' && !/^\d{7,8}$/.test(limpio)) {
      setError('El DNI tiene 7 u 8 números.');
      return;
    }
    const cond: CondicionIva = tipo === 'dni' ? 'consumidor_final' : condicion;
    const cuerpo = {
      nombre: nombre.trim(),
      documento: { tipo, numero: limpio },
      condicionIva: cond,
      domicilio: domicilio.trim() || null,
    };
    setGuardando(true);
    setError(null);
    try {
      const id = clienteId
        ? (await api('PATCH', `/api/v1/clientes/${clienteId}`, cuerpo), clienteId)
        : (await api<{ id: string }>('POST', '/api/v1/clientes', cuerpo)).id;
      alGuardar({
        id,
        nombre: cuerpo.nombre,
        documento: cuerpo.documento,
        condicion: cond,
        domicilio: cuerpo.domicilio,
      });
    } catch (e) {
      setError(mensajeDeError(e));
      setGuardando(false);
    }
  }

  return (
    <form className="formulario cliente-fiscal" onSubmit={guardar}>
      <fieldset className="campo">
        <legend>Documento</legend>
        <div className="chips">
          {(['cuit', 'dni'] as const).map((t) => (
            <label key={t} className="chip chip--radio">
              <input
                type="radio"
                name="tipo-documento"
                checked={tipo === t}
                onChange={() => {
                  setTipo(t);
                  setDeArca(null);
                }}
              />
              {t === 'cuit' ? 'CUIT' : 'DNI'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="cliente-fiscal__numero">
        <Campo
          etiqueta={tipo === 'cuit' ? 'CUIT' : 'DNI'}
          inputMode="numeric"
          autoComplete="off"
          placeholder={tipo === 'cuit' ? '20-12345678-6' : '30123456'}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          error={errorNumero}
          required
        />
        {tipo === 'cuit' && (
          <button
            type="button"
            className="m-boton"
            disabled={!cuitListo || !enLinea || buscando}
            aria-busy={buscando}
            onClick={() => void buscar(limpio)}
          >
            {buscando ? 'Buscando…' : 'Buscar en ARCA'}
          </button>
        )}
      </div>
      {tipo === 'cuit' && !enLinea && (
        <p className="texto-suave">Sin internet no se puede buscar en ARCA: cargalo a mano.</p>
      )}
      {deArca && (
        <p className="texto-suave cliente-fiscal__arca" role="status">
          {deArca}
        </p>
      )}
      <Campo
        etiqueta={tipo === 'cuit' ? 'Nombre o razón social' : 'Nombre'}
        value={nombre}
        maxLength={80}
        onChange={(e) => setNombre(e.target.value)}
        required
      />
      {tipo === 'cuit' ? (
        <div className="campo">
          <label htmlFor="cliente-condicion">Condición frente al IVA</label>
          <select
            id="cliente-condicion"
            className="campo__entrada"
            value={condicion}
            onChange={(e) => setCondicion(e.target.value as CondicionIva)}
          >
            {Object.entries(CONDICIONES_IVA).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="texto-suave">Con DNI, la factura sale a consumidor final con su nombre.</p>
      )}
      <Campo
        etiqueta="Domicilio (opcional)"
        value={domicilio}
        maxLength={200}
        onChange={(e) => setDomicilio(e.target.value)}
      />
      {error && <Aviso>{error}</Aviso>}
      <div className="acciones">
        <button className="m-boton m-boton--principal" disabled={guardando}>
          {guardando ? 'Guardando…' : textoGuardar}
        </button>
        {alCancelar && (
          <button type="button" className="m-boton" onClick={alCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
