// Aplica el tema del equipo antes de pintar. Mantener en sincronía con packages/ui/src/temas.ts.
(function () {
  var colores = { noche: '#111936', dia: '#EEF1F5', pizarron: '#15302A', contraste: '#000000' };
  var tema = 'noche';
  try {
    var guardado = localStorage.getItem('mostrador.tema');
    if (guardado && Object.prototype.hasOwnProperty.call(colores, guardado)) tema = guardado;
  } catch {
    // Sin almacenamiento: queda el tema por defecto.
  }
  document.documentElement.setAttribute('data-tema', tema);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colores[tema]);
})();
