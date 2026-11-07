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

/** Shell of the administrative area: header, section sidebar (wide) or index
 * (compact), and one scrolling content column that uses the whole width left
 * over by the rail and the conversation sidebar. */
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

  return (
    <div className="flex h-full min-h-0 select-text flex-col">
      <PageHeader
        title={compactSection ? t(section.labelKey as never) : t('layout.title')}
        subtitle={mode === 'wide' && section ? t(section.labelKey as never) : undefined}
        leading={compactSection ? (
          <AppLink to={ADMIN_PATH} aria-label={t('layout.backToAdmin')} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
            <ArrowLeftIcon size={20} aria-hidden />
          </AppLink>
        ) : undefined}
      />
      <div ref={areaRef} className="@container flex min-h-0 min-w-0 flex-1">
        {mode === 'wide' && lost === null ? <AdminSidebar /> : null}
        <main ref={scrollerRef} aria-label={section ? t(section.labelKey as never) : t('layout.title')} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div ref={contentRef} className="flex w-full flex-col gap-4 px-4 py-4 @[520px]:px-6 @[960px]:px-8 @[960px]:py-6">
            {lost === 'access' ? <AccessLost /> : lost === 'session' ? <SessionEnded /> : <Outlet context={{ mode, measured, tableFits: contentWidth === 0 || contentWidth >= ADMIN_TABLE_MIN, scroller: scrollerRef } satisfies AdminOutletContext} />}
          </div>
        </main>
      </div>
    </div>
  );
}
