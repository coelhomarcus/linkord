import { createContext, useContext } from 'react';
import { useLocation } from 'react-router';
import type { Location } from 'react-router';

const ContentLocationContext = createContext<Location | null>(null);
export const ContentLocationProvider = ContentLocationContext.Provider;

/** The page the content area is showing. With a modal open (settings,
 * administration) the URL names the modal while the page underneath stays
 * where it was, so whatever marks "where you are" (the rail, the conversation
 * list) reads this instead of the URL. Outside the provider it is the URL. */
export function useContentLocation(): Location {
  const content = useContext(ContentLocationContext);
  const location = useLocation();
  return content ?? location;
}
