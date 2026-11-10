import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('copyToClipboard', () => {
  afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard'); });

  it('writes the text and says "Copiado"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    await expect(copyToClipboard('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(liveAnnouncements()).toEqual(['Copiado']);
  });

  it('a refused write says nothing and reports the failure', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
    await expect(copyToClipboard('abc')).resolves.toBe(false);
    expect(liveAnnouncements()).toEqual([]);
  });

  describe('in English', () => {
    useLanguageForTests('en-US');
    it('says it in the active language', async () => {
      stubClipboard(vi.fn().mockResolvedValue(undefined));
      await copyToClipboard('abc');
      expect(liveAnnouncements()).toEqual(['Copied']);
    });
  });
});
