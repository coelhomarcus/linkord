import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { cn } from '@/shared/lib/utils';
import { SignOutIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives/button';
import { AdminBrand } from './AdminBrand';
import { AdminMobileNavigation, AdminNavigation } from './AdminNavigation';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { consumeScrollRestore, invalidateAdminLists } from './adminListCache';
import type { AdminIdentity } from './adminSessionApi';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';

export function AdminLayout({ viewer, onSignOut, signingOut, signOutFailed }: {
  viewer: AdminIdentity;
  onSignOut: () => void;
  signingOut: boolean;
  signOutFailed: boolean;
}) {
  const { t } = useTranslation('admin');
  const areaRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentWidth = useElementWidth(contentRef);
  const firstRender = useRef(true);
  const { pathname } = useLocation();
  // Only mount the drawer at narrow widths so resizing closes its focus trap.
  const wide = useAdminLayout(areaRef) === 'wide';
  const section = sectionForPath(pathname);
  const detail = /^\/admin\/[^/]+\/[^/]+\/?$/.test(pathname);
  const label = section ? t(section.labelKey) : t('layout.title');

  useEffect(() => invalidateAdminLists, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (consumeScrollRestore()) return;
    scrollerRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  const account = (
    <div className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="hidden shrink-0 min-[440px]:flex">
        <Avatar id={viewer.id} name={viewer.username} avatar={viewer.avatar ?? ''} avatarColor={viewer.avatarColor} size={28} />
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-label text-text-secondary min-[360px]:block" title={`@${viewer.username}`}>@{viewer.username}</span>
      <Button type="button" variant="ghost" size="icon" className="text-text-muted" aria-label={t('site.signOut')} title={t('site.signOut')} disabled={signingOut} onClick={onSignOut}>
        <SignOutIcon aria-hidden className="size-4" />
      </Button>
    </div>
  );

  return (
    <div ref={areaRef} className="flex h-full min-h-0 min-w-0">
      <aside className="admin-sidebar hidden w-64 shrink-0 flex-col min-[960px]:flex">
        <Link to={ADMIN_PATH} className="mx-3 my-4 flex min-h-10 shrink-0 items-center rounded-md px-3 focus-ring"><AdminBrand /></Link>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-5"><AdminNavigation /></div>
        {wide && <div className="shrink-0 border-t border-border-divider px-4 py-3">{account}</div>}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-topbar flex min-h-14 shrink-0 items-center justify-between gap-3 px-3 min-[960px]:hidden">
          <div className="flex shrink-0 items-center gap-1.5">
            {!wide && <AdminMobileNavigation />}
            <Link to={ADMIN_PATH} className="rounded-md focus-ring"><AdminBrand /></Link>
          </div>
          {!wide && account}
        </header>
        {signOutFailed && <ErrorBanner className="m-4">{t('site.signOutFailed')}</ErrorBanner>}
        <main ref={scrollerRef} aria-label={label} className="@container min-h-0 min-w-0 flex-1 overflow-y-auto select-text [scrollbar-gutter:stable]">
          <div className={cn(
            'mx-auto w-full min-w-0 px-4 pt-7 pb-12 @[640px]:px-7 @[1024px]:px-9 @[1024px]:pt-11',
            detail ? 'max-w-[1080px]' : 'max-w-[1480px]',
          )}>
            <div ref={contentRef} className="@container flex min-w-0 flex-col gap-6 @[760px]:gap-8">
              <Outlet context={{ contentWidth, scroller: scrollerRef } satisfies AdminOutletContext} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
