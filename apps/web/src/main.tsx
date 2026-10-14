import '@mostrador/ui/base.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
