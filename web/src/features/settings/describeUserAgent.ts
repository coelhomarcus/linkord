/** What a session list can say about a browser from its user agent: the browser and system names (proper
 * names, never translated) and whether it is a phone or tablet. Order matters: Edge and Opera also say
 * "Chrome", Chrome also says "Safari", every iOS browser is Safari underneath. */
export interface DeviceDescription {
  browser: string | null;
  os: string | null;
  mobile: boolean;
}

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
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(userAgent))?.[1] ?? null;
  return { browser, os, mobile: /\bMobile\b|\biPhone\b|\biPad\b|\bAndroid\b/.test(userAgent) };
}
