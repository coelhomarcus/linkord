import { ArrowLeftIcon } from '@overcord/frontend-shared/ui/icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Outlet, useLocation } from 'react-router';
import { buttonVariants } from '@overcord/frontend-shared/ui/primitives/button';
import { useElementWidth } from '@overcord/frontend-shared/hooks/useElementWidth';
import { consumeScrollRestore, invalidateAdminLists } from './adminListCache';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { AdminSidebar } from './AdminNavigation';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';
import { AppLink } from '@overcord/frontend-shared/ui/app-link';
import { cn } from '@overcord/frontend-shared/lib/utils';

/** Wide layouts keep navigation beside the scrolling content. Compact layouts have an index. */
export function AdminLayout() {
  const { t } = useTranslation('admin');
  const areaRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentWidth = useElementWidth(contentRef);
  const firstRender = useRef(true);
  const { pathname } = useLocation();
  const { mode, measured } = useAdminLayout(areaRef);
  const section = sectionForPath(pathname);
  const compactSection = mode === 'compact' && section !== null;
  const detail = /^\/admin\/[^/]+\/[^/]+\/?$/.test(pathname);

  useEffect(() => invalidateAdminLists, []);

  // opening another page starts at its top instead of inheriting the previous scroll
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // a list that just restored its own position keeps it
    if (consumeScrollRestore()) return;
    scrollerRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  const content = (
    <div className={cn(
      'mx-auto w-full min-w-0 px-4 pt-6 pb-12 @[640px]:px-7 @[1024px]:px-8 @[1024px]:pt-8',
      detail ? 'max-w-[1040px]' : 'max-w-[1480px]',
    )}>
      <div ref={contentRef} className="@container flex min-w-0 flex-col gap-6">
        <Outlet context={{ mode, measured, contentWidth, scroller: scrollerRef } satisfies AdminOutletContext} />
      </div>
    </div>
  );
  const label = section ? t(section.labelKey as never) : t('layout.title');

  // one <main> and one content column in both modes, so the width observer keeps watching the same element
  return (
    <div ref={areaRef} className="flex h-full min-h-0 min-w-0 select-text flex-col">
      {compactSection && (
        <div className="flex h-11 flex-none items-center border-b border-border-divider px-4">
          <AppLink to={ADMIN_PATH} aria-label={t('layout.backToAdmin')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeftIcon size={18} aria-hidden /> {t('layout.title')}
          </AppLink>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        {mode === 'wide' && (
          <div className="scrollbar-none flex flex-none overflow-y-auto border-r border-border-divider bg-surface-rail">
            <AdminSidebar />
          </div>
        )}
        {/* a stable gutter: a short page and a scrolling one keep the column in the same place */}
        <main ref={scrollerRef} aria-label={label} className="@container flex min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {content}
        </main>
      </div>
    </div>
  );
}
