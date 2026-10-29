import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/layout/ErrorBoundary';
import { installGlobalErrorHandlers } from './shared/lib/logger';
import './styles/index.css';
import { applyColorTheme } from '@/features/settings/applyColorTheme';
import { loadColorTheme } from '@/features/settings/useColorThemePreference';

// Hover an element and press ⌘C / Ctrl+C to copy its source for the agent.
// Vite drops this from production builds (`import.meta.env.DEV`).
if (import.meta.env.DEV) {
  void import('react-grab');
}

installGlobalErrorHandlers();
applyColorTheme(loadColorTheme());

// Register on load only in a build. In dev, opening notification settings can
// register it for an explicit Push test without putting it in every Vite tab.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
