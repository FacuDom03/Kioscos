// Íconos de la barra de navegación (trazo, heredan el color del texto). Decorativos.
const comun = {
  className: 'm-nav__icono',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

export const IconoVender = () => (
  <svg {...comun}>
    <path d="M3 9h18l-1.5 10.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M8 9V7a4 4 0 0 1 8 0v2" />
  </svg>
);

export const IconoStock = () => (
  <svg {...comun}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
);

export const IconoCaja = () => (
  <svg {...comun}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M7 15h3" />
  </svg>
);

export const IconoMas = () => (
  <svg {...comun}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </svg>
);
