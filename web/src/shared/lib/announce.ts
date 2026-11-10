const REGION_ATTRIBUTE = 'data-live-announcer';
// long enough for a screen reader to have read the message; removing it earlier can cut it off
const MESSAGE_LIFETIME_MS = 7000;

/** One polite live region for the whole page, made once and never removed. A region that appears
 * already holding its text is often not read at all, so the region exists before the first message.
 * It sits on <body> with its own aria-live, which Base UI's modals leave exposed while they hide
 * everything else behind them, so a message from inside a dialog is still heard. No role: the screens'
 * own `role="status"` lines stay the only ones a test or a screen reader's list of regions finds. */
function region(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const existing = document.body.querySelector<HTMLElement>(`[${REGION_ATTRIBUTE}]`);
  if (existing) return existing;
  const element = document.createElement('div');
  element.setAttribute(REGION_ATTRIBUTE, '');
  element.setAttribute('aria-live', 'polite');
  Object.assign(element.style, {
    position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
    overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: '0',
  });
  document.body.appendChild(element);
  return element;
}

region();

/** Reads a short confirmation to screen readers without moving focus, for actions whose result is
 * only visual (a check mark) or not visible at all (a menu that closed). Each message is its own node,
 * so the same words twice in a row are read twice. */
export function announce(message: string): void {
  const target = region();
  if (!target) return;
  const node = document.createElement('div');
  node.textContent = message;
  target.appendChild(node);
  window.setTimeout(() => node.remove(), MESSAGE_LIFETIME_MS);
}
