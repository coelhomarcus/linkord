import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

/** Whether the main pointer cannot hover (a phone or tablet): controls that a mouse reveals on hover are
 * offered another way there, since a tap would land on them before they show. */
export function useTouchFirst(): boolean {
  return useMediaQuery('(hover: none)');
}
