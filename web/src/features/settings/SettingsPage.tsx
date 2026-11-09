import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { PageHeader } from '@/shared/PageHeader';
import { Button } from '@/shared/ui/primitives/button';
import { useAppModalClose } from '@/shared/ui/app-modal';
import { EscCloseButton } from '@/shared/ui/esc-close-button';
import { LEGACY_SETTINGS_TABS, ROUTES, isSettingsTab } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { ConnectionsSettings } from '@/features/profile/ConnectionsSettings';
import { AccountSettings } from './AccountSettings';
import { AdminLinkTab } from './AdminLinkTab';
import { AppearanceSettings } from './AppearanceSettings';
import { AudioVideoSettings } from './AudioVideoSettings';
import { ChatSettings } from './ChatSettings';
import { LanguageSettings } from './LanguageSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { PrivacyTab } from './PrivacyTab';
import { SecuritySettings } from './SecuritySettings';
import { SettingsContent, SettingsPageHeader } from '@/shared/ui/settings-layout';
import { SettingsIndex, SettingsSidebar } from './SettingsNavigation';
import { findCategory } from './settingsCatalog';
import { useSettingsLayout } from './useSettingsLayout';

interface SettingsPageProps {
  onOpenProfile: (userId: string) => void;
}

function CategoryPage({ tab, onOpenProfile }: { tab: SettingsTab; onOpenProfile: (userId: string) => void }) {
  switch (tab) {
    case 'account': return <AccountSettings onOpenProfile={onOpenProfile} />;
    case 'security': return <SecuritySettings />;
    case 'connections': return <ConnectionsSettings />;
    case 'privacy': return <PrivacyTab onOpenProfile={onOpenProfile} />;
    case 'appearance': return <AppearanceSettings />;
    case 'av': return <AudioVideoSettings />;
    case 'chat': return <ChatSettings />;
    case 'notifications': return <NotificationsSettings />;
    case 'language': return <LanguageSettings />;
    case 'moderation': return <AdminLinkTab />;
  }
}

/** Discord's user settings, inside the settings modal: wide, a column of
 * categories beside the open one and the round ESC button after it; narrow,
 * an index of categories that opens one at a time. */
export function SettingsPage({ onOpenProfile }: SettingsPageProps) {
  const { t } = useTranslation('settings');
  const { state } = useRoom();
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const closeModal = useAppModalClose();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const mode = useSettingsLayout(areaRef);
  const firstRender = useRef(true);
  const isAdmin = state.me.role === 'admin';

  const known = isSettingsTab(tab) && (tab !== 'moderation' || isAdmin);
  const active: SettingsTab | null = known ? tab : null;
  // wide: no category in the URL just means "the first one", on the same URL;
  // compact: it is the index
  const showIndex = mode === 'compact' && active === null;
  const current: SettingsTab = active ?? 'account';
  const category = findCategory(current);

  // opening another category starts at its top, with its title focused; a hash
  // (/app/settings/av#video) wins and scrolls to — and focuses — that section
  // instead (a search result is exactly this: SettingsSection carries
  // tabIndex={-1} on purpose for this to land somewhere real).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!location.hash) return;
    }
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView?.({ block: 'start' });
      target?.focus?.({ preventScroll: true });
      return;
    }
    scrollerRef.current?.scrollTo?.({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [current, showIndex, location.hash]);

  if (tab !== undefined && !known) {
    const legacy = LEGACY_SETTINGS_TABS[tab];
    // an unknown category — or the admin-only one for a non-admin — falls back
    // to the first one instead of rendering an empty page
    return <Navigate to={ROUTES.settingsTab(legacy ?? 'account')} replace />;
  }

  const page = (
    <SettingsContent>
      <SettingsPageHeader title={t(category.labelKey)} headingRef={headingRef} />
      <CategoryPage tab={current} onOpenProfile={onOpenProfile} />
    </SettingsContent>
  );

  // the measured wrapper stays the same element in both modes, so the
  // observer keeps watching it after a switch
  return <div ref={areaRef} className="flex h-full min-h-0 min-w-0 flex-col">{mode === 'wide' ? wide() : compact()}</div>;

  function wide() {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="scrollbar-none flex flex-none overflow-y-auto border-r border-border-subtle">
          <SettingsSidebar active={current} isAdmin={isAdmin} onOpenProfile={onOpenProfile} />
        </div>
        {/* a stable gutter: a short page and a scrolling one keep the column in the same place */}
        <main ref={scrollerRef} aria-label={t(category.labelKey)} className="@container flex min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {page}
          {closeModal && <EscCloseButton onClose={closeModal} className="pt-8" />}
        </main>
      </div>
    );
  }

  function compact() {
    const compactDetail = active !== null;
    const fromIndex = (location.state as { fromIndex?: boolean } | null)?.fromIndex === true;
    return (
      <>
      <PageHeader
        title={compactDetail ? t(category.labelKey) : t('title')}
        leading={compactDetail ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('back')}
            onClick={() => (fromIndex ? navigate(-1) : navigate(ROUTES.settings))}
          >
            <ArrowLeftIcon size={20} aria-hidden />
          </Button>
        ) : undefined}
      />
      <main ref={scrollerRef} aria-label={showIndex ? t('title') : t(category.labelKey)} className="@container min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {showIndex ? <SettingsIndex isAdmin={isAdmin} onOpenProfile={onOpenProfile} /> : page}
      </main>
      </>
    );
  }
}
