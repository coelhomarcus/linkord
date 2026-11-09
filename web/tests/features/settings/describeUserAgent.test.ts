import { describe, expect, it } from 'vitest';
import { describeUserAgent } from '@/features/settings/describeUserAgent';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('describeUserAgent', () => {
  it('names the browser before the engines it imitates', () => {
    expect(describeUserAgent(UA.chromeMac)).toEqual({ browser: 'Chrome', os: 'macOS', mobile: false });
    expect(describeUserAgent(UA.edgeWindows)).toEqual({ browser: 'Edge', os: 'Windows', mobile: false });
    expect(describeUserAgent(UA.operaWindows).browser).toBe('Opera');
    expect(describeUserAgent(UA.firefoxLinux)).toEqual({ browser: 'Firefox', os: 'Linux', mobile: false });
  });

  it('tells iOS from macOS and Android from Linux, and marks phones', () => {
    expect(describeUserAgent(UA.safariIphone)).toEqual({ browser: 'Safari', os: 'iOS', mobile: true });
    expect(describeUserAgent(UA.chromeIphone)).toEqual({ browser: 'Chrome', os: 'iOS', mobile: true });
    expect(describeUserAgent(UA.chromeAndroid)).toEqual({ browser: 'Chrome', os: 'Android', mobile: true });
  });

  it('says nothing it cannot tell', () => {
    expect(describeUserAgent('')).toEqual({ browser: null, os: null, mobile: false });
    expect(describeUserAgent('curl/8.4.0')).toEqual({ browser: null, os: null, mobile: false });
  });
});
