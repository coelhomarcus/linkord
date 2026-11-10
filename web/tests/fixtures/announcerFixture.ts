/** What the page's live region (`shared/lib/announce.ts`) currently holds for screen readers, one
 * entry per message still in it. `tests/setup.ts` empties it after every test. */
export function liveAnnouncements(): string[] {
  const region = document.querySelector('[data-live-announcer]');
  return region ? [...region.children].map((node) => node.textContent ?? '') : [];
}
