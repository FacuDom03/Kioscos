// Detector de ráfagas de un lector de código de barras USB o Bluetooth (sección 14.1).
// Estos lectores "escriben" como un teclado: muchos caracteres muy rápido y al final Enter.

export interface OpcionesLector {
  /** Máximo entre teclas para considerarlo lector (ms). */
  maxEntreTeclas?: number;
  /** Largo mínimo del código. */
  minimo?: number;
}

export class DetectorRafagas {
  private buffer = '';
  private ultima = 0;
  private readonly max: number;
  private readonly minimo: number;

  constructor(o: OpcionesLector = {}) {
    this.max = o.maxEntreTeclas ?? 35;
    this.minimo = o.minimo ?? 6;
  }

  /**
   * Procesa una tecla. Devuelve el código leído cuando llega Enter al final de una ráfaga válida;
   * si no, null. `tiempo` en milisegundos (por ejemplo, `event.timeStamp`).
   */
  tecla(key: string, tiempo: number): string | null {
    const gap = tiempo - this.ultima;
    this.ultima = tiempo;
    if (key === 'Enter') {
      const codigo = this.buffer;
      const valido = codigo.length >= this.minimo && gap < this.max * 3;
      this.reiniciar();
      return valido ? codigo : null;
    }
    if (key.length !== 1) {
      this.reiniciar();
      return null;
    }
    if (this.buffer && gap > this.max) {
      // Demasiado lento: es una persona. Empieza una ráfaga nueva desde esta tecla.
      this.buffer = '';
    }
    this.buffer += key;
    return null;
  }

  /** ¿Hay una ráfaga en curso? Sirve para evitar que el texto aparezca en otro campo. */
  enCurso(tiempo: number): boolean {
    return this.buffer.length >= 2 && tiempo - this.ultima <= this.max;
  }

  reiniciar(): void {
    this.buffer = '';
  }
}
