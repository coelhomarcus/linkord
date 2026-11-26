import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MotionConfig } from 'motion/react';
import { AdminApp } from '@/app/AdminApp';
import { ErrorBoundary } from '@/app/layout/ErrorBoundary';
import { initI18n } from '@/shared/i18n/init';
import { installGlobalErrorHandlers } from '@/shared/lib/logger';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import './styles/index.css';

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
