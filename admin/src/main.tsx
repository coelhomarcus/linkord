import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MotionConfig } from 'motion/react';
import { AdminApp } from '@/app/AdminApp';
import { ErrorBoundary } from '@linkord/frontend-shared/ui/ErrorBoundary';
import { initI18n } from '@/i18n/init';
import { installGlobalErrorHandlers } from '@linkord/frontend-shared/lib/logger';
import { TooltipProvider } from '@linkord/frontend-shared/ui/primitives/tooltip';
import './styles/admin.css';

initI18n();
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <BrowserRouter>
            <AdminApp />
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
