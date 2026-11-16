import { describe, expect, it } from 'vitest';
import { detectPlatform, downloadsFor, type DesktopDownloads } from '@/features/desktopApp/desktopDownloads';

const nav = (userAgent: string, extra: Record<string, unknown> = {}) => ({ userAgent, maxTouchPoints: 0, ...extra }) as unknown as Navigator;
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('detectPlatform', () => {
  it('tells Windows, macOS and Linux apart', async () => {
    expect(await detectPlatform(nav(WIN))).toEqual({ os: 'windows' });
    expect(await detectPlatform(nav(MAC))).toEqual({ os: 'mac' });
    expect(await detectPlatform(nav('Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0'))).toEqual({ os: 'linux' });
  });

  it('reads a Mac\'s chip where the browser tells it', async () => {
    const getHighEntropyValues = async () => ({ architecture: 'x86' });
    expect(await detectPlatform(nav(MAC, { userAgentData: { platform: 'macOS', getHighEntropyValues } }))).toEqual({ os: 'mac', arch: 'x86' });
  });

  it('offers nothing to phones, tablets and Chromebooks', async () => {
    expect(await detectPlatform(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142.0'))).toBeNull();
    expect(await detectPlatform(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBeNull();
    expect(await detectPlatform(nav(MAC, { maxTouchPoints: 5 }))).toBeNull();
    expect(await detectPlatform(nav('Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) Chrome/142.0'))).toBeNull();
  });
});

describe('downloadsFor', () => {
  const downloads: DesktopDownloads = {
    version: '0.3.0',
    page: 'https://github.com/o/r/releases/tag/v0.3.0',
    files: { windows: 'w', macArm: 'ma', macIntel: 'mi', appImage: 'ai', deb: 'd' },
  };

  it('puts each system\'s installer first', () => {
    expect(downloadsFor(downloads, { os: 'windows' })).toEqual({ primary: 'windows', others: [] });
    expect(downloadsFor(downloads, { os: 'mac' })).toEqual({ primary: 'macArm', others: ['macIntel'] });
    expect(downloadsFor(downloads, { os: 'mac', arch: 'x86' })).toEqual({ primary: 'macIntel', others: ['macArm'] });
    expect(downloadsFor(downloads, { os: 'linux' })).toEqual({ primary: 'appImage', others: ['deb'] });
  });

  it('has nothing to offer when that system has no installer', () => {
    expect(downloadsFor({ ...downloads, files: { macArm: 'ma' } }, { os: 'windows' }).primary).toBeNull();
  });
});
