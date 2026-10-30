import type { ComponentPropsWithRef } from 'react';
import { createPath, Link } from 'react-router';
import type { To } from 'react-router';

import { cn } from '@/shared/lib/utils';

type AppLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href'> & {
  to: To;
  state?: unknown;
  replace?: boolean;
};

/** Links expose their destination to the browser, including new-tab actions. */
export function AppLink({ to, state, replace, className, ...props }: AppLinkProps) {
  return (
    <Link
      to={to}
      data-to={typeof to === 'string' ? to : createPath(to)}
      state={state}
      replace={replace}
      {...props}
      className={cn('cursor-pointer', className)}
    />
  );
}
