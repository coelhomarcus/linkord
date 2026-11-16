import { describe, expect, it } from 'vitest';
import { isWindowsComputer } from '@/features/desktopApp/desktopDownloads';

const nav = (userAgent: string, extra: Record<string, unknown> = {}) => ({ userAgent, ...extra }) as unknown as Navigator;
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('isWindowsComputer', () => {
  it('recognises Windows, from the user agent or the client hints', () => {
    expect(isWindowsComputer(nav(WIN))).toBe(true);
    expect(isWindowsComputer(nav(MAC, { userAgentData: { platform: 'Windows' } }))).toBe(true);
  });

  it('leaves out every other system, phones included', () => {
    expect(isWindowsComputer(nav(MAC))).toBe(false);
    expect(isWindowsComputer(nav('Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0'))).toBe(false);
    expect(isWindowsComputer(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0'))).toBe(false);
    expect(isWindowsComputer(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBe(false);
    expect(isWindowsComputer(nav(WIN, { userAgentData: { platform: 'macOS' } }))).toBe(false);
  });
});
