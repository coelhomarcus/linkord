import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { personInitials } from '@/shared/lib/initials';
import { cn } from '@/shared/lib/utils';
import { CaretRightIcon, SignOutIcon } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/primitives/button';
import { AdminBrand } from './AdminBrand';
import { AdminMobileNavigation, AdminNavigation } from './AdminNavigation';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { consumeScrollRestore, invalidateAdminLists } from './adminListCache';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';

export function AdminLayout({ username, onSignOut, signingOut, signOutFailed }: {
  username: string;
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

  return (
    <div ref={areaRef} className="flex h-full min-h-0 min-w-0">
      <aside className="admin-sidebar scrollbar-none hidden w-60 shrink-0 flex-col overflow-y-auto min-[960px]:flex">
        <Link to={ADMIN_PATH} className="flex min-h-17 shrink-0 items-center px-6 focus-ring focus-visible:ring-inset"><AdminBrand /></Link>
        <div className="px-4 pt-5 pb-8"><AdminNavigation /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-topbar flex min-h-17 shrink-0 items-center justify-between gap-2 px-3 sm:gap-4 sm:px-7">
          <nav aria-label={t('layout.breadcrumb')} className="hidden min-w-0 items-center gap-2 text-label min-[960px]:flex">
            <Link to={ADMIN_PATH} className="truncate rounded-sm text-text-muted focus-ring hover:text-text-primary">{t('layout.title')}</Link>
            <CaretRightIcon aria-hidden size={14} className="shrink-0 text-text-muted" />
            <span className="truncate font-semibold text-text-primary">{label}</span>
          </nav>
          <div className="flex min-w-0 items-center gap-2 min-[960px]:hidden">
            {!wide && <AdminMobileNavigation />}
            <Link to={ADMIN_PATH} className="min-w-0 rounded-lg focus-ring"><AdminBrand /></Link>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="hidden size-8 shrink-0 place-items-center rounded-full border border-border-default bg-surface-overlay text-caption font-bold text-accent-text min-[410px]:grid">{personInitials(username)}</span>
            <span className="hidden truncate text-label font-semibold text-text-secondary sm:block" title={`@${username}`}>@{username}</span>
            <Button type="button" variant="ghost" className="h-9 px-2.5 text-text-muted" disabled={signingOut} onClick={onSignOut}>
              <SignOutIcon aria-hidden className="size-4" />
              <span className="max-sm:sr-only">{t('site.signOut')}</span>
            </Button>
          </div>
        </header>
        {signOutFailed && <ErrorBanner className="m-4">{t('site.signOutFailed')}</ErrorBanner>}
        <main ref={scrollerRef} aria-label={label} className="@container min-h-0 min-w-0 flex-1 overflow-y-auto select-text [scrollbar-gutter:stable]">
          <div className={cn(
            'mx-auto w-full min-w-0 px-4 pt-6 pb-12 @[640px]:px-7 @[1024px]:px-8 @[1024px]:pt-8',
            detail ? 'max-w-[1080px]' : 'max-w-[1480px]',
          )}>
            <div ref={contentRef} className="@container flex min-w-0 flex-col gap-5">
              <Outlet context={{ contentWidth, scroller: scrollerRef } satisfies AdminOutletContext} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
