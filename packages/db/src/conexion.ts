import pg from 'pg';

// bigint (int8) llega como string por defecto. La plata está en centavos y entra holgada en un
// entero seguro de JS; si alguna vez no entra, se corta acá en vez de redondear en silencio.
pg.types.setTypeParser(pg.types.builtins.INT8, (valor: string) => {
  const n = Number(valor);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('Valor bigint fuera del rango seguro de JavaScript');
  }
  return n;
});

// Las fechas sin hora (date) llegan como texto "AAAA-MM-DD": convertirlas a Date las corre de día
// según la zona horaria del servidor.
pg.types.setTypeParser(pg.types.builtins.DATE, (valor: string) => valor);

export function crearPool(connectionString: string, opciones: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, ...opciones });
}

export function variableRequerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}
