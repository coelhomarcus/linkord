import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { initI18n } from '@/i18n/init';

initI18n('pt-BR');

afterEach(() => {
  cleanup();
  document.querySelector('[data-live-announcer]')?.replaceChildren();
});
