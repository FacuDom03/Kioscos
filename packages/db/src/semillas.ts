// Datos ficticios de dos kioscos (A y B) para desarrollo y pruebas.
// Cada tabla de negocio queda con filas de los dos, así la prueba de aislamiento es real.
// Se cargan con el usuario administrador (que no pasa por RLS).
import { uuidv7 } from '@mostrador/shared';
import type pg from 'pg';

export const KIOSCO_A = '0192a000-0000-7000-8000-00000000000a';
export const KIOSCO_B = '0192a000-0000-7000-8000-00000000000b';

interface DatosKiosco {
  id: string;
  nombre: string;
  email: string;
}

const KIOSCOS: DatosKiosco[] = [
  { id: KIOSCO_A, nombre: 'Kiosco Anita', email: 'anita@ejemplo.test' },
  { id: KIOSCO_B, nombre: 'Almacén Don Beto', email: 'beto@ejemplo.test' },
];

async function cargarKiosco(c: pg.Client | pg.PoolClient, k: DatosKiosco): Promise<void> {
  const q = (texto: string, valores: unknown[]) => c.query(texto, valores);

  await q(
    `insert into kioscos (id, nombre, plan, estado_suscripcion) values ($1, $2, 'comercio', 'prueba')`,
    [k.id, k.nombre],
  );

  const dueno = uuidv7();
  const cajero = uuidv7();
  await q(`insert into usuarios (id, email, nombre) values ($1, $2, $3), ($4, null, 'Cajero')`, [
    dueno,
    k.email,
    k.nombre.split(' ').pop(),
    cajero,
  ]);
  const membresiaDueno = uuidv7();
  const membresiaCajero = uuidv7();
  await q(
    `insert into membresias (id, kiosco_id, usuario_id, rol) values ($1, $2, $3, 'dueno'), ($4, $2, $5, 'cajero')`,
    [membresiaDueno, k.id, dueno, membresiaCajero, cajero],
  );

  const dispositivo = uuidv7();
  await q(
    `insert into dispositivos (id, kiosco_id, nombre, credencial_hash) values ($1, $2, 'PC mostrador', $3)`,
    [dispositivo, k.id, `hash-dispositivo-${k.id}`],
  );
  await q(
    `insert into pines (id, kiosco_id, membresia_id, pin_hash) values ($1, $2, $3, 'hash-de-prueba')`,
    [uuidv7(), k.id, membresiaCajero],
  );

  const bebidas = uuidv7();
  const golosinas = uuidv7();
  await q(
    `insert into categorias (id, kiosco_id, nombre, orden) values ($1, $3, 'Bebidas', 1), ($2, $3, 'Golosinas', 2)`,
    [bebidas, golosinas, k.id],
  );

  const coca = uuidv7();
  const alfajor = uuidv7();
  await q(
    `insert into productos (id, kiosco_id, categoria_id, nombre, precio, costo, stock_actual, stock_minimo)
     values ($1, $3, $4, 'Coca-Cola 500 ml', 180000, 120000, 24, 12),
            ($2, $3, $5, 'Alfajor triple', 120000, 70000, 3, 10)`,
    [coca, alfajor, k.id, bebidas, golosinas],
  );
  await q(
    `insert into codigos_barra (id, kiosco_id, producto_id, codigo, tipo)
     values ($1, $3, $4, '7790895000997', 'ean13'), ($2, $3, $5, '7790040000001', 'ean13')`,
    [uuidv7(), uuidv7(), k.id, coca, alfajor],
  );

  const compra = uuidv7();
  await q(`insert into compras (id, kiosco_id, usuario_id, total) values ($1, $2, $3, 2880000)`, [
    compra,
    k.id,
    dueno,
  ]);
  await q(
    `insert into compra_items (id, kiosco_id, compra_id, producto_id, cantidad, costo_unitario, subtotal)
     values ($1, $2, $3, $4, 24, 120000, 2880000)`,
    [uuidv7(), k.id, compra, coca],
  );
  await q(
    `insert into movimientos_stock (id, kiosco_id, producto_id, tipo, cantidad, costo_unitario, compra_id, usuario_id)
     values ($1, $2, $3, 'compra', 24, 120000, $4, $5)`,
    [uuidv7(), k.id, coca, compra, dueno],
  );

  await q(
    `insert into cambios_precio (id, kiosco_id, usuario_id, alcance, porcentaje, redondeo, detalle)
     values ($1, $2, $3, 'todo', 10, 5000, $4)`,
    [
      uuidv7(),
      k.id,
      dueno,
      JSON.stringify([{ producto_id: coca, antes: 165000, despues: 180000 }]),
    ],
  );

  const esmaltes = uuidv7();
  await q(
    `insert into grupos_variantes (id, kiosco_id, nombre, tipo) values ($1, $2, 'Esmalte cremoso', 'tono')`,
    [esmaltes, k.id],
  );
  const promo = uuidv7();
  await q(
    `insert into promos (id, kiosco_id, nombre, lleva, paga, descuento, grupo_id)
     values ($1, $2, '3x2 en esmaltes', 3, 2, 100, $3)`,
    [promo, k.id, esmaltes],
  );
  await q(
    `insert into lotes (id, kiosco_id, producto_id, vence_en, cantidad, usuario_id)
     values ($1, $2, $3, current_date + 40, 24, $4)`,
    [uuidv7(), k.id, coca, dueno],
  );

  const proveedor = uuidv7();
  await q(`insert into proveedores (id, kiosco_id, nombre) values ($1, $2, 'Distribuidora Sur')`, [
    proveedor,
    k.id,
  ]);
  await q(
    `insert into producto_proveedor (id, kiosco_id, producto_id, proveedor_id, codigo, costo)
     values ($1, $2, $3, $4, 'SUR-0001', 120000)`,
    [uuidv7(), k.id, coca, proveedor],
  );
  await q(
    `insert into listas_proveedor (id, kiosco_id, proveedor_id, usuario_id, archivo, renglones, opciones, detalle)
     values ($1, $2, $3, $4, 'lista.xlsx', 1, '{}', $5)`,
    [
      uuidv7(),
      k.id,
      proveedor,
      dueno,
      JSON.stringify([{ producto_id: coca, costo_antes: 110000, costo: 120000 }]),
    ],
  );

  const presupuesto = uuidv7();
  await q(
    `insert into presupuestos (id, kiosco_id, numero, usuario_id, para, total, vence_en)
     values ($1, $2, 1, $3, 'Obra de la esquina', 360000, current_date + 15)`,
    [presupuesto, k.id, dueno],
  );
  await q(
    `insert into presupuesto_items (id, kiosco_id, presupuesto_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
     values ($1, $2, $3, $4, 'Coca-Cola 500 ml', 2, 180000, 360000)`,
    [uuidv7(), k.id, presupuesto, coca],
  );

  const caja = uuidv7();
  await q(`insert into cajas (id, kiosco_id) values ($1, $2)`, [caja, k.id]);
  const turno = uuidv7();
  await q(
    `insert into turnos_caja (id, kiosco_id, caja_id, abierto_por, cambio_inicial) values ($1, $2, $3, $4, 1000000)`,
    [turno, k.id, caja, cajero],
  );
  await q(
    `insert into gastos (id, kiosco_id, turno_id, usuario_id, tipo, monto, motivo)
     values ($1, $2, $3, $4, 'gasto', 250000, 'Bolsas')`,
    [uuidv7(), k.id, turno, cajero],
  );

  const venta = uuidv7();
  await q(
    `insert into ventas (id, kiosco_id, turno_id, usuario_id, dispositivo_id, total, estado, creada_en_dispositivo)
     values ($1, $2, $3, $4, $5, 300000, 'cobrada', now())`,
    [venta, k.id, turno, cajero, dispositivo],
  );
  await q(
    `insert into venta_items (id, kiosco_id, venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
     values ($1, $3, $4, $5, 'Coca-Cola 500 ml', 1, 180000, 180000),
            ($2, $3, $4, $6, 'Alfajor triple', 1, 120000, 120000)`,
    [uuidv7(), uuidv7(), k.id, venta, coca, alfajor],
  );
  await q(
    `insert into pagos (id, kiosco_id, venta_id, medio, monto, recibido, vuelto, estado, confirmado_en)
     values ($1, $2, $3, 'efectivo', 300000, 500000, 200000, 'aprobado', now())`,
    [uuidv7(), k.id, venta],
  );
  await q(
    `insert into movimientos_stock (id, kiosco_id, producto_id, tipo, cantidad, venta_id, usuario_id)
     values ($1, $3, $4, 'venta', -1, $6, $7), ($2, $3, $5, 'venta', -1, $6, $7)`,
    [uuidv7(), uuidv7(), k.id, coca, alfajor, venta, cajero],
  );
  // Un cambio: devuelve el alfajor de la venta anterior y se lleva otro igual.
  const itemAlfajor = (
    await q(
      `select id from venta_items where kiosco_id = $1 and venta_id = $2 and producto_id = $3`,
      [k.id, venta, alfajor],
    )
  ).rows[0].id as string;
  const cambio = uuidv7();
  await q(
    `insert into ventas (id, kiosco_id, turno_id, usuario_id, dispositivo_id, total, estado, regalo, creada_en_dispositivo)
     values ($1, $2, $3, $4, $5, 0, 'cobrada', true, now())`,
    [cambio, k.id, turno, cajero, dispositivo],
  );
  await q(
    `insert into venta_items (id, kiosco_id, venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
     values ($1, $2, $3, $4, 'Alfajor triple', 1, 120000, 120000)`,
    [uuidv7(), k.id, cambio, alfajor],
  );
  await q(
    `insert into devoluciones (id, kiosco_id, venta_id, venta_item_id, producto_id, descripcion, cantidad, importe)
     values ($1, $2, $3, $4, $5, 'Alfajor triple', 1, 120000)`,
    [uuidv7(), k.id, cambio, itemAlfajor, alfajor],
  );
  await q(
    `insert into venta_descuentos (id, kiosco_id, venta_id, promo_id, descripcion, monto)
     values ($1, $2, $3, $4, '3x2 en esmaltes', 1)`,
    [uuidv7(), k.id, venta, promo],
  );

  const cliente = uuidv7();
  await q(
    `insert into clientes (id, kiosco_id, nombre, telefono, limite) values ($1, $2, 'Rosa', '11 5555-0000', 4000000)`,
    [cliente, k.id],
  );
  await q(
    `insert into movimientos_cuenta (id, kiosco_id, cliente_id, tipo, monto, usuario_id)
     values ($1, $2, $3, 'ajuste', 1820000, $4)`,
    [uuidv7(), k.id, cliente, dueno],
  );

  await q(
    `insert into integraciones (id, kiosco_id, proveedor, estado) values ($1, $2, 'mercadopago', 'desconectado')`,
    [uuidv7(), k.id],
  );
  await q(
    `insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en)
     values ($1, $2, $3, 'encargado', $4, now() + interval '72 hours')`,
    [uuidv7(), k.id, k.email.replace('@', '.encargado@'), `hash-invitacion-${k.id}`],
  );
  await q(
    `insert into oauth_estados (id, kiosco_id, usuario_id, state_hash, verificador_cifrado, clave_version, vence_en)
     values ($1, $2, $3, $4, '\\x00', 1, now() + interval '10 minutes')`,
    [uuidv7(), k.id, dueno, `hash-state-${k.id}`],
  );
  await q(
    `insert into config_fiscal (id, kiosco_id, cuit, razon_social, condicion, punto_venta, domicilio, estado)
     values ($1, $2, '20409378472', $3, 'monotributo', 3, 'Calle Falsa 123', 'pausada')`,
    [uuidv7(), k.id, k.nombre],
  );
  await q(
    `insert into comprobantes (id, kiosco_id, venta_id, tipo, punto_venta, total, prueba)
     values ($1, $2, $3, 'factura_c', 3, 100, true)`,
    [uuidv7(), k.id, venta],
  );
  await q(`insert into personalizacion (id, kiosco_id, pie) values ($1, $2, $3)`, [
    uuidv7(),
    k.id,
    `Gracias por comprar en ${k.nombre}`,
  ]);
  await q(
    `insert into claves_api (id, kiosco_id, nombre, prefijo, token_hash, creada_por)
     values ($1, $2, 'n8n de prueba', 'mst_semill', $3, $4)`,
    [uuidv7(), k.id, `hash-clave-api-${k.id}`, dueno],
  );
  await q(
    `insert into webhooks (id, kiosco_id, url, eventos, secreto_cifrado, clave_version, creado_por)
     values ($1, $2, 'https://n8n.ejemplo.test/webhook/ventas', '{venta.creada}', '\\x00', 1, $3)`,
    [uuidv7(), k.id, dueno],
  );
  await q(
    `insert into auditoria (id, kiosco_id, usuario_id, accion, detalle) values ($1, $2, $3, 'semillas.cargadas', '{}')`,
    [uuidv7(), k.id, dueno],
  );
}

/** Carga los dos kioscos de prueba. Si ya están, no hace nada. */
export async function cargarSemillas(c: pg.Client | pg.PoolClient): Promise<boolean> {
  const { rowCount } = await c.query('select 1 from kioscos where id = any($1)', [
    KIOSCOS.map((k) => k.id),
  ]);
  if (rowCount) return false;

  await c.query('begin');
  try {
    for (const k of KIOSCOS) await cargarKiosco(c, k);
    await c.query(
      `insert into eventos_webhook (id, proveedor, evento_id, resultado) values ($1, 'mercadopago', 'evento-de-prueba', 'ignorado')`,
      [uuidv7()],
    );
    await c.query('commit');
  } catch (error) {
    await c.query('rollback');
    throw error;
  }
  return true;
}
