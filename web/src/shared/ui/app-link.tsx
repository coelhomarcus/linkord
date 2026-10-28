import type { ComponentPropsWithRef } from 'react';
import { createPath, useNavigate } from 'react-router';
import type { To } from 'react-router';

import { cn } from '@/shared/lib/utils';

type AppLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href'> & {
  to: To;
  state?: unknown;
  replace?: boolean;
};

/** In-app navigation without an href. The app lives at one address with an
 * in-memory router, so an href would only make the browser show a URL that
 * leads nowhere (on hover, in "open in new tab"). It still reads and behaves
 * as a link: focusable, Enter follows it. Something that opens a modal is a
 * button instead. */
export function AppLink({ to, state, replace, onClick, onKeyDown, className, ...props }: AppLinkProps) {
  const navigate = useNavigate();
  const follow = () => navigate(to, { state, replace });
  return (
    <a
      role="link"
      tabIndex={0}
      // where it goes, for tests and the devtools: not an href, so the browser shows nothing
      data-to={typeof to === 'string' ? to : createPath(to)}
      {...props}
      className={cn('cursor-pointer', className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        follow();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== 'Enter') return;
        event.preventDefault();
        follow();
      }}
    />
  );
}
