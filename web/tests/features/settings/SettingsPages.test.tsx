import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { AppearanceSettings } from '@/features/settings/AppearanceSettings';
import { AudioVideoSettings } from '@/features/settings/AudioVideoSettings';
import { LanguageSettings } from '@/features/settings/LanguageSettings';
import { getAudioPreferences } from '@/features/calls/audioPreferences';
import { getTimeFormat, setTimeFormat } from '@/shared/lib/timeFormat';

vi.mock('@/features/settings/useLanguageSetting', () => ({
  useLanguageSetting: () => ({ language: 'pt-BR', setLanguage: vi.fn(), saveFailed: false }),
}));
vi.mock('@/features/calls/inputProfile', () => ({ applyInputProfile: vi.fn(async () => undefined) }));

beforeEach(() => {
  localStorage.clear();
  setTimeFormat('auto');
});

describe('AppearanceSettings', () => {
  it('shows each theme as a swatch, the current one checked, and picks another on click', async () => {
    const setColorTheme = vi.fn();
    renderWithRoom(<AppearanceSettings />, { colorTheme: 'black', setColorTheme });
    expect(screen.getByRole('radio', { name: 'Tema Black' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Tema Graphite' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Tema Graphite' }));
    expect(setColorTheme).toHaveBeenCalledWith('discord');
  });
});

describe('LanguageSettings', () => {
  it('chooses the time format, with an example time under each choice', async () => {
    renderWithRoom(<LanguageSettings />);
    expect(screen.getByRole('radio', { name: /Auto/ })).toBeChecked();
    expect(screen.getByText('14:30')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: /12 horas/ }));
    expect(getTimeFormat()).toBe('12h');
  });
});

describe('AudioVideoSettings', () => {
  it('saves the input profile chosen here for the next call', async () => {
    renderWithRoom(<AudioVideoSettings />);
    await userEvent.setup().click(screen.getByRole('radio', { name: /Estúdio/ }));
    expect(getAudioPreferences().inputProfile).toBe('studio');
  });

  it('keeps the mic meter on screen before any test, so starting one moves nothing', () => {
    renderWithRoom(<AudioVideoSettings />);
    expect(screen.getByRole('meter', { name: 'Nível do microfone' })).toHaveAttribute('aria-valuenow', '0');
  });
});
