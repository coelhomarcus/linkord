import { describe, expect, it } from 'vitest';
import { describeUserAgent } from '@/features/settings/describeUserAgent';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  headlessChromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
  unknownBrowserLinux: 'Mozilla/5.0 (X11; Linux x86_64) SomeEngine/1.0',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('describeUserAgent', () => {
  it('names the browser before the engines it imitates', () => {
    expect(describeUserAgent(UA.chromeMac)).toEqual({ browser: 'Chrome', os: 'macOS', mobile: false, automated: false });
    expect(describeUserAgent(UA.edgeWindows)).toEqual({ browser: 'Edge', os: 'Windows', mobile: false, automated: false });
    expect(describeUserAgent(UA.operaWindows).browser).toBe('Opera');
    expect(describeUserAgent(UA.firefoxLinux)).toEqual({ browser: 'Firefox', os: 'Linux', mobile: false, automated: false });
  });

  it('tells iOS from macOS and Android from Linux, and marks phones', () => {
    expect(describeUserAgent(UA.safariIphone)).toEqual({ browser: 'Safari', os: 'iOS', mobile: true, automated: false });
    expect(describeUserAgent(UA.chromeIphone)).toEqual({ browser: 'Chrome', os: 'iOS', mobile: true, automated: false });
    expect(describeUserAgent(UA.chromeAndroid)).toEqual({ browser: 'Chrome', os: 'Android', mobile: true, automated: false });
  });

  it('says nothing it cannot tell', () => {
    expect(describeUserAgent('')).toEqual({ browser: null, os: null, mobile: false, automated: false });
  });

  it('keeps the system when the browser is unknown', () => {
    expect(describeUserAgent(UA.unknownBrowserLinux)).toEqual({ browser: null, os: 'Linux', mobile: false, automated: false });
  });

  it.each([
    'curl/8.4.0',
    'Wget/1.21.4',
    'python-requests/2.31.0',
    'Python-urllib/3.12',
    'python-httpx/0.27.0',
    'Python/3.12 aiohttp/3.9.1',
    'node',
    'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
    'undici',
    'axios/1.6.0',
    'Go-http-client/2.0',
    'PostmanRuntime/7.37.0',
  ])('flags %s as an app or script', (userAgent) => {
    expect(describeUserAgent(userAgent)).toMatchObject({ browser: null, automated: true });
  });

  it('flags a headless browser as a script and still names its system', () => {
    expect(describeUserAgent(UA.headlessChromeMac)).toEqual({ browser: null, os: 'macOS', mobile: false, automated: true });
  });

  it('does not take a real browser for a script', () => {
    for (const ua of [UA.chromeMac, UA.edgeWindows, UA.safariIphone, UA.firefoxLinux, UA.chromeAndroid]) {
      expect(describeUserAgent(ua).automated).toBe(false);
    }
  });
});
