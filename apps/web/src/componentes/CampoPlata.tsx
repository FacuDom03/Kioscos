import { formatearPlata, parsearPesos } from '@mostrador/shared';
import { useId, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'> & {
  etiqueta: string;
  valor: number | null;
  alCambiar: (centavos: number | null) => void;
  error?: string | null;
};

const aTexto = (c: number | null) =>
  c === null ? '' : formatearPlata(c).replace('$ ', '').replace('-$ ', '-');

/** Campo de plata: se escribe en pesos ("1.500" o "1500,50") y se guarda en centavos. */
export function CampoPlata({ etiqueta, valor, alCambiar, error, ...props }: Props) {
  const id = useId();
  const [texto, setTexto] = useState(aTexto(valor));
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) {
    // El valor cambió desde afuera (por ejemplo, un botón rápido).
    setUltimo(valor);
    if (parsearPesos(texto) !== valor) setTexto(aTexto(valor));
  }
  const invalido = texto.trim() !== '' && parsearPesos(texto) === null;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <div className="campo-plata">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          className={`campo__entrada m-plata${error || invalido ? ' campo__entrada--error' : ''}`}
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          aria-invalid={error || invalido ? true : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            const c = parsearPesos(e.target.value);
            setUltimo(c);
            alCambiar(c);
          }}
          {...props}
        />
      </div>
      {(error || invalido) && (
        <p className="campo__error">{error ?? 'Escribí el monto en pesos, por ejemplo 1.500.'}</p>
      )}
    </div>
  );
}
