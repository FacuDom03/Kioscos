// Lector de código de barras USB o Bluetooth: detecta ráfagas aunque el foco no esté en el
// buscador y manda el código al flujo de venta con el evento "mostrador:codigo".
import { DetectorRafagas } from '@mostrador/shared';

/** Campos que ya reciben el código ellos mismos (no se interceptan). */
const RECIBEN_CODIGO = '[data-recibe-codigo]';

export function iniciarLector(): () => void {
  const detector = new DetectorRafagas();
  const alTeclear = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    const enCampo = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    // Si el foco está en otro campo de texto (por ejemplo, el monto contado), no se intercepta.
    if (enCampo) {
      detector.reiniciar();
      return;
    }
    if (t?.closest(RECIBEN_CODIGO)) return;
    const codigo = detector.tecla(ev.key, ev.timeStamp);
    if (codigo) {
      ev.preventDefault();
      window.dispatchEvent(new CustomEvent('mostrador:codigo', { detail: codigo }));
    }
  };
  window.addEventListener('keydown', alTeclear, true);
  return () => window.removeEventListener('keydown', alTeclear, true);
}
