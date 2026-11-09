/** What a session list can say about a client from its user agent: the browser and system names (proper
 * names, never translated), whether it is a phone or tablet, and whether it is no person's browser at all
 * (a script, a command-line tool or a headless browser). Order matters: Edge and Opera also say "Chrome",
 * Chrome also says "Safari", every iOS browser is Safari underneath. */
export interface DeviceDescription {
  browser: string | null;
  os: string | null;
  mobile: boolean;
  automated: boolean;
}

/** HeadlessChrome is listed because it never matches `Chrome/` (no word boundary before it), so it would
 * otherwise read as an unknown browser; Node's own fetch sends just "node". */
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
