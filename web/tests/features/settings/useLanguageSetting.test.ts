import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLanguageSetting } from '@/features/settings/useLanguageSetting';
import { ApiError } from '@/shared/api/api';
import { i18n } from '@/shared/i18n/init';
import { loadStoredLanguage } from '@/shared/i18n/languagePreference';

const updateLocale = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  updateLocale: (...args: unknown[]) => updateLocale(...args),
}));

beforeEach(async () => {
  updateLocale.mockReset();
  localStorage.clear();
  await i18n.changeLanguage('pt-BR');
});

afterEach(() => localStorage.clear());

describe('useLanguageSetting', () => {
  it('switches the UI, remembers it on this browser and saves it on the account', async () => {
    updateLocale.mockResolvedValue({ locale: 'en-US' });
    const { result } = renderHook(() => useLanguageSetting());

    await act(() => result.current.setLanguage('en-US'));

    expect(updateLocale).toHaveBeenCalledWith('en-US');
    expect(i18n.language).toBe('en-US');
    expect(loadStoredLanguage()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(result.current.saveFailed).toBe(false);
  });

  it('rolls back to the previous language when the account cannot save it', async () => {
    updateLocale.mockRejectedValue(new ApiError(500, 'unknown_error', 'x'));
    const { result } = renderHook(() => useLanguageSetting());

    await act(() => result.current.setLanguage('en-US'));

    expect(i18n.language).toBe('pt-BR');
    expect(loadStoredLanguage()).toBe('pt-BR');
    expect(result.current.saveFailed).toBe(true);
  });
});
