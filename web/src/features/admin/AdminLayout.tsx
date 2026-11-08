import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Outlet, useLocation, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/PageHeader';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { useAppModalClose } from '@/shared/ui/app-modal';
import { EscCloseButton } from '@/shared/ui/esc-close-button';
import { subscribeAdminAccessLost, subscribeAdminSessionEnded } from './adminAccess';
import { consumeScrollRestore, invalidateAdminLists } from './adminListCache';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { AdminSidebar } from './AdminNavigation';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';
import { AppLink } from '@/shared/ui/app-link';

/** Width of the content column below which a 5–6 column table would cut its last columns. */
const ADMIN_TABLE_MIN = 820;

/** Shown when the server stopped treating this account as an administrator.
 * The pages are gone by then (their data, dialogs and pending reads with them);
 * leaving also fixes the stale role so the guard and the rail agree. */
function AccessLost() {
  const { t } = useTranslation('admin');
  const { dispatch } = useRoom();
  const navigate = useNavigate();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <h2 className="text-title font-semibold text-text-primary">{t('layout.accessLostTitle')}</h2>
      <p className="max-w-md text-label text-text-muted">{t('layout.accessLostDescription')}</p>
      <Button type="button" onClick={() => { dispatch({ type: 'SET_ROLE', role: 'user' }); navigate(ROUTES.home, { replace: true }); }}>
        {t('layout.backToConversations')}
      </Button>
    </div>
  );
}

/** Shown when the server says there is no session: the area is gone, and the
 * auth state is re-read so the app can take the person to the login. */
function SessionEnded() {
  const { t } = useTranslation('admin');
  const { refresh } = useAuth();
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-12 text-center">
      <h2 className="text-title font-semibold text-text-primary">{t('layout.sessionEndedTitle')}</h2>
      <p className="max-w-md text-label text-text-muted">{t('layout.sessionEndedDescription')}</p>
    </div>
  );
}

/** Shell of the administrative area, built like the settings: wide, the section list beside one
 * scrolling column of content and the round ESC button; compact, a header with a way back over one page
 * (or the section index). The content column is wider than the settings' 740px: lists are tables. */
export function AdminLayout() {
  const { t } = useTranslation('admin');
  const areaRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentWidth = useElementWidth(contentRef);
  const firstRender = useRef(true);
  const { pathname } = useLocation();
  const { mode, measured } = useAdminLayout(areaRef);
  const closeModal = useAppModalClose();
  const section = sectionForPath(pathname);
  const compactSection = mode === 'compact' && section !== null;
  const [lost, setLost] = useState<'access' | 'session' | null>(null);

  useEffect(() => subscribeAdminAccessLost(() => { invalidateAdminLists(); setLost('access'); }), []);
  useEffect(() => subscribeAdminSessionEnded(() => { invalidateAdminLists(); setLost('session'); }), []);
  // remembered list windows belong to this visit of the area
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
    <div ref={contentRef} className="flex w-full min-w-0 max-w-[1040px] flex-col gap-6 px-4 pb-16 pt-6 @[520px]:px-8 @[520px]:pt-8">
      {lost === 'access' ? <AccessLost /> : lost === 'session' ? <SessionEnded /> : <Outlet context={{ mode, measured, tableFits: contentWidth === 0 || contentWidth >= ADMIN_TABLE_MIN, scroller: scrollerRef } satisfies AdminOutletContext} />}
    </div>
  );
  const label = section ? t(section.labelKey as never) : t('layout.title');

  // one <main> and one content column in both modes, so the width observer keeps watching the same element
  return (
    <div ref={areaRef} className="flex h-full min-h-0 min-w-0 select-text flex-col">
      {mode === 'compact' && (
        <PageHeader
          title={compactSection ? t(section.labelKey as never) : t('layout.title')}
          leading={compactSection ? (
            <AppLink to={ADMIN_PATH} aria-label={t('layout.backToAdmin')} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
              <ArrowLeftIcon size={20} aria-hidden />
            </AppLink>
          ) : undefined}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        {mode === 'wide' && lost === null && <div className="scrollbar-none flex flex-none overflow-y-auto border-r border-border-subtle"><AdminSidebar /></div>}
        {/* a stable gutter: a short page and a scrolling one keep the column in the same place */}
        <main ref={scrollerRef} aria-label={label} className="@container flex min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {content}
          {mode === 'wide' && closeModal && <EscCloseButton onClose={closeModal} className="pt-8" />}
        </main>
      </div>
    </div>
  );
}
