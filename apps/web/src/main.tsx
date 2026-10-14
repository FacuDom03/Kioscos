import '@mostrador/ui/base.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { registrarServiceWorker } from './nucleo/actualizacion.ts';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registrarServiceWorker();
