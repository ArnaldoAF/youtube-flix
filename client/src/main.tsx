import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './auth';
import { AppStateProvider } from './store';
import './index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
);
