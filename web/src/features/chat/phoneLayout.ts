// the same cut-off as the CSS `md` breakpoint and SidebarProvider's phone layout
const PHONE_QUERY = '(max-width: 767px)';

/** Read at the moment of the interaction, not subscribed to: the chat only
 * needs to know which layout a touch or a key press landed in. */
export function isPhoneLayout(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;
}
