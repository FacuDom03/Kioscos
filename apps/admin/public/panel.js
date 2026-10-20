// Panel de administración. Sin HTML armado con strings: todo con textContent.
'use strict';

const $ = (sel) => document.querySelector(sel);

async function api(metodo, url, cuerpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || 'Error'), { status: r.status });
  return datos;
}

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'texto') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const h of hijos) e.append(h);
  return e;
}

const fecha = (v) => (v ? new Date(v).toLocaleString('es-AR') : '—');

function mostrarEnlace(enlace, texto) {
  $('#enlace').hidden = false;
  $('#enlace-texto').value = enlace;
  $('#whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`${texto} ${enlace}`)}`;
}

const RUBROS = {
  kiosco: 'Kiosco',
  almacen: 'Almacén',
  ferreteria: 'Ferretería',
  perfumeria: 'Perfumería',
  libreria: 'Librería',
  otro: 'Otro rubro',
};

async function cargarKioscos() {
  const kioscos = await api('GET', '/panel/api/kioscos');
  const filas = $('#filas');
  filas.replaceChildren();
  for (const k of kioscos) {
    const plan = el(
      'select',
      {},
      el('option', { value: 'esencial', texto: 'Esencial' }),
      el('option', { value: 'comercio', texto: 'Comercio' }),
    );
    plan.value = k.plan;
    const estado = el('select', {});
    for (const e of ['prueba', 'activa', 'vencida', 'suspendida', 'baja'])
      estado.append(el('option', { value: e, texto: e }));
    estado.value = k.estado_suscripcion;
    const guardar = el('button', {
      type: 'button',
      texto: 'Guardar',
      onclick: async () => {
        try {
          await api('PATCH', `/panel/api/kioscos/${k.id}`, {
            plan: plan.value,
            estado: estado.value,
          });
          guardar.textContent = 'Guardado';
        } catch (e) {
          alert(e.message);
        }
      },
    });
    const invitar = el('button', {
      type: 'button',
      texto: 'Nueva invitación',
      onclick: async () => {
        const email = prompt('Email del dueño', k.dueno_email || '');
        if (!email) return;
        try {
          const r = await api('POST', `/panel/api/kioscos/${k.id}/invitacion`, { email });
          mostrarEnlace(r.enlace, `Hola! Entrá a Mostrador para ${k.nombre}:`);
        } catch (e) {
          alert(e.message);
        }
      },
    });
    const soporteActivo = k.soporte_hasta && new Date(k.soporte_hasta) > new Date();
    const soporte = soporteActivo
      ? el('button', {
          type: 'button',
          texto: 'Entrar como soporte',
          onclick: async () => {
            try {
              const r = await api('POST', `/panel/api/kioscos/${k.id}/soporte`, {});
              window.open(r.enlace, '_blank', 'noopener');
            } catch (e) {
              alert(e.message);
            }
          },
        })
      : el('span', { texto: 'Apagado' });
    filas.append(
      el(
        'tr',
        {},
        el('td', { texto: k.nombre }),
        el('td', {
          texto: `${RUBROS[k.rubro] ?? k.rubro}${k.configurado ? '' : ' (sin confirmar)'}`,
        }),
        el('td', { texto: k.dueno_email || 'Sin dueño todavía' }),
        el('td', {}, plan),
        el('td', {}, estado),
        el('td', { texto: String(k.usuarios) }),
        el('td', { texto: fecha(k.ultima_venta) }),
        el('td', {}, soporte),
        el('td', {}, guardar, invitar),
      ),
    );
  }
}

const ESTADOS_FACTURACION = {
  pendiente: 'Esperando que aceptes',
  activa: 'Activa',
  pausada: 'En pausa (la pausó el comercio)',
  desconectada: 'Desconectada en ARCA',
  suspendida: 'Suspendida por Mostrador',
};

const pesos = (centavos) => `$ ${Math.round(Number(centavos) / 100).toLocaleString('es-AR')}`;
const cuitConGuiones = (c) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

async function accionFacturacion(kioscoId, accion) {
  try {
    await api('POST', `/panel/api/facturacion/${kioscoId}/accion`, { accion });
    await cargarFacturacion();
  } catch (e) {
    alert(e.message);
  }
}

async function cargarFacturacion() {
  const filas = $('#filas-facturacion');
  const lista = await api('GET', '/panel/api/facturacion');
  filas.replaceChildren();
  $('#sin-facturacion').hidden = lista.length > 0;
  for (const f of lista) {
    const acciones = el('td', {});
    if (f.estado === 'pendiente' || f.estado === 'desconectada')
      acciones.append(
        el('button', {
          type: 'button',
          texto: 'Ya lo acepté',
          onclick: () => accionFacturacion(f.kiosco_id, 'aceptada'),
        }),
      );
    if (f.estado === 'suspendida')
      acciones.append(
        el('button', {
          type: 'button',
          texto: 'Reactivar',
          onclick: () => accionFacturacion(f.kiosco_id, 'reactivar'),
        }),
      );
    else
      acciones.append(
        el('button', {
          type: 'button',
          texto: 'Suspender',
          onclick: () => {
            if (confirm(`¿Suspender la facturación de ${f.comercio}? Corta en el momento.`))
              accionFacturacion(f.kiosco_id, 'suspender');
          },
        }),
      );
    acciones.append(
      el('button', {
        type: 'button',
        texto: 'Cambiar tope',
        onclick: async () => {
          const texto = prompt(
            'Tope diario en pesos (sin puntos)',
            String(Math.round(Number(f.tope_diario) / 100)),
          );
          if (!texto) return;
          try {
            await api('PUT', `/panel/api/facturacion/${f.kiosco_id}/tope`, {
              pesos: Number(texto.replace(/\D/g, '')),
            });
            await cargarFacturacion();
          } catch (e) {
            alert(e.message);
          }
        },
      }),
    );
    const alertas = el('td', {});
    if (f.alertas.length === 0) alertas.append(el('span', { texto: '—' }));
    for (const a of f.alertas) alertas.append(el('span', { class: 'alerta', texto: a }));
    filas.append(
      el(
        'tr',
        {},
        el('td', { texto: f.comercio }),
        el('td', { texto: `${cuitConGuiones(f.cuit)} · ${f.razon_social}` }),
        el('td', { texto: String(f.punto_venta) }),
        el('td', {
          texto: `${ESTADOS_FACTURACION[f.estado] ?? f.estado}${f.ultimo_error && f.estado !== 'activa' ? ` — ${f.ultimo_error}` : ''}`,
        }),
        el('td', {
          texto: `${pesos(f.facturado_hoy)} de ${pesos(f.tope_diario)} · ${f.facturas_hoy} facturas, ${f.notas_hoy} notas de crédito · ${f.pendientes} por salir`,
        }),
        alertas,
        el('td', {
          texto: f.terminos_aceptados_en
            ? `Versión ${f.terminos_version}, ${fecha(f.terminos_aceptados_en)}`
            : 'Sin aceptar',
        }),
        acciones,
      ),
    );
  }
}

async function iniciar() {
  try {
    const yo = await api('GET', '/panel/api/yo');
    $('#quien').textContent = yo.email;
    $('#login').hidden = true;
    $('#kioscos').hidden = false;
    await cargarKioscos();
    await cargarFacturacion();
  } catch {
    $('#login').hidden = false;
    $('#kioscos').hidden = true;
  }
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api('POST', '/panel/api/login', Object.fromEntries(f));
    ev.target.reset();
    await iniciar();
  } catch (e) {
    ev.target.querySelector('.error').textContent = e.message;
  }
});

$('#form-alta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  try {
    const r = await api('POST', '/panel/api/kioscos', datos);
    mostrarEnlace(
      r.enlace,
      `Hola! Ya está tu cuenta de Mostrador para ${datos.nombre}. Entrá acá:`,
    );
    ev.target.reset();
    ev.target.querySelector('.error').textContent = '';
    await cargarKioscos();
  } catch (e) {
    ev.target.querySelector('.error').textContent = e.message;
  }
});

$('#copiar').addEventListener('click', () =>
  navigator.clipboard.writeText($('#enlace-texto').value),
);
$('#salir').addEventListener('click', async () => {
  await api('POST', '/panel/api/salir', {});
  await iniciar();
});

iniciar();
