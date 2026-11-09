/** Server copy of web/src/features/settings/describeUserAgent.ts, so an alert email names a browser the
 * way the session list does. The two are pinned together by tests/modules/auth/describeUserAgent.test.ts:
 * change one and the other follows. */
export interface DeviceDescription {
  browser: string | null;
  os: string | null;
  mobile: boolean;
  automated: boolean;
}

const AUTOMATED = /^node\b|\bcurl\/|\bWget\/|\bpython-(?:requests|urllib|httpx)\/|\baiohttp\/|\bundici\b|\bnode-fetch\b|\baxios\/|\bGo-http-client\/|\bPostmanRuntime\/|\bHeadlessChrome\//i;

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function describeUserAgent(userAgent: string): DeviceDescription {
  const automated = AUTOMATED.test(userAgent);
  const browser = automated ? null : BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(userAgent))?.[1] ?? null;
  return { browser, os, mobile: /\bMobile\b|\biPhone\b|\biPad\b|\bAndroid\b/.test(userAgent), automated };
}
