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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
