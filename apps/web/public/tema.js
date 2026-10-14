// Aplica el tema y el estilo guardados antes de pintar. Mantener en sincronía con
// packages/ui/src/temas.ts.
(function () {
  var colores = {
    noche: '#111936',
    dia: '#EEF1F5',
    pizarron: '#15302A',
    sobrio: '#F2F3F5',
    grafito: '#16191D',
    boutique: '#FAF8F9',
    contraste: '#000000',
  };
  var tema = 'noche';
  var estilo = 'kiosco';
  try {
    var guardado = localStorage.getItem('mostrador.tema');
    if (guardado && Object.prototype.hasOwnProperty.call(colores, guardado)) tema = guardado;
    if (localStorage.getItem('mostrador.estilo') === 'sobrio') estilo = 'sobrio';
  } catch {
    // Sin almacenamiento: quedan el tema y el estilo por defecto.
  }
  document.documentElement.setAttribute('data-tema', tema);
  document.documentElement.setAttribute('data-estilo', estilo);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colores[tema]);
})();
