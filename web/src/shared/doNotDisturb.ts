// Whether the account is set to "do not disturb". A plain module flag, not React state, because the
// places that obey it (playSound, the in-page desktop notifications) are plain functions called from
// socket handlers. Set by features/status/useOwnStatus.ts from the account's status.

let doNotDisturb = false;

export function setDoNotDisturb(value: boolean): void {
  doNotDisturb = value;
}

export function isDoNotDisturb(): boolean {
  return doNotDisturb;
}
