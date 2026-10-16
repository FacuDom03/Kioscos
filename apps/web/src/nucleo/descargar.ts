/** Baja un archivo de la API con la sesión y lo guarda en el equipo con ese nombre. */
export async function descargar(url: string, nombre: string): Promise<void> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('No se pudo descargar. Probá de nuevo.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const hoyArgentina = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
