import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

/** Campo con etiqueta visible y mensaje de error asociado. */
export function Campo({
  etiqueta,
  error,
  ayuda,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  error?: string | null;
  ayuda?: ReactNode;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        className={`campo__entrada${error ? ' campo__entrada--error' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={ayuda || error ? idAyuda : undefined}
        {...props}
      />
      {(ayuda || error) && (
        <p id={idAyuda} className={error ? 'campo__error' : 'campo__ayuda'}>
          {error ?? ayuda}
        </p>
      )}
    </div>
  );
}

export function Aviso({
  tipo = 'error',
  children,
}: {
  tipo?: 'error' | 'ok' | 'info';
  children: ReactNode;
}) {
  return (
    <p className={`aviso aviso--${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function Volver({ onClick, texto = 'Volver' }: { onClick: () => void; texto?: string }) {
  return (
    <button type="button" className="m-boton volver" onClick={onClick}>
      <span aria-hidden="true">‹</span> {texto}
    </button>
  );
}
