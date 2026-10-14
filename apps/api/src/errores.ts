/** Error con un mensaje pensado para mostrarle a la persona (qué pasó y qué hacer). */
export class ErrorPublico extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export const noEncontrado = () =>
  new ErrorPublico(404, 'no_encontrado', 'No encontramos lo que buscás.');
export const sinPermiso = () =>
  new ErrorPublico(403, 'sin_permiso', 'No tenés permiso para hacer esto. Pedíselo al dueño.');
export const datosInvalidos = (mensaje = 'Revisá los datos e intentá de nuevo.') =>
  new ErrorPublico(400, 'datos_invalidos', mensaje);
export const credencialesInvalidas = () =>
  new ErrorPublico(401, 'credenciales', 'Email, contraseña o código incorrectos.');
