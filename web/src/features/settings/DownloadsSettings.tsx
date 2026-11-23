import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import {
  ArrowSquareOutIcon, ArrowsClockwiseIcon, BellRingingIcon, CheckCircleIcon, DeviceMobileIcon, DownloadSimpleIcon, ExportIcon,
  GameControllerIcon, GlobeIcon, InfoIcon, LightningIcon, PlusSquareIcon, PowerIcon, UsersThreeIcon, WindowsLogoIcon,
  type IconComponent,
} from '@/shared/ui/icons';
import { isWindowsComputer } from '@/features/desktopApp/desktopDownloads';
import { useDesktopDownloads } from '@/features/desktopApp/useDesktopDownloads';
import { useInstall } from '@/features/install/installPrompt';
import { isDesktopApp } from '@/shared/desktop';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { AppLink } from '@/shared/ui/app-link';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { SettingsSection, SettingsSections } from '@/shared/ui/settings-layout';

type Recommendation = 'windows' | 'web' | null;

/** Which of the two fits this device: none inside the desktop app, which already is one. */
function recommendation(): Recommendation {
  if (isDesktopApp()) return null;
  return isWindowsComputer() ? 'windows' : 'web';
}

/** The two ways to take Linkord out of a browser tab, side by side and explained. */
export function DownloadsSettings() {
  const { t } = useTranslation('settings');
  const recommended = recommendation();

  return (
    <SettingsSections>
      <SettingsSection id="get-the-app" title={t('downloads.title')} description={t('downloads.description')}>
        <div className="grid grid-cols-1 gap-4 @[600px]:grid-cols-2">
          {/* the one that fits this device comes first, which on a phone means on top */}
          {recommended === 'web' ? (
            <>
              <WebAppCard recommended />
              <WindowsAppCard recommended={false} />
            </>
          ) : (
            <>
              <WindowsAppCard recommended={recommended === 'windows'} />
              <WebAppCard recommended={false} />
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection id="which-one" title={t('downloads.compare.title')}>
        <ul className="flex flex-col gap-5">
          <CompareRow icon={GameControllerIcon} question={t('downloads.compare.windows.question')} answer={t('downloads.compare.windows.answer')} />
          <CompareRow icon={DeviceMobileIcon} question={t('downloads.compare.web.question')} answer={t('downloads.compare.web.answer')} />
          <CompareRow icon={UsersThreeIcon} question={t('downloads.compare.both.question')} answer={t('downloads.compare.both.answer')} />
        </ul>
      </SettingsSection>
    </SettingsSections>
  );
}

function WindowsAppCard({ recommended }: { recommended: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <AppCard
      id="windows-app"
      icon={WindowsLogoIcon}
      platforms={t('downloads.windows.platforms')}
      title={t('downloads.windows.title')}
      description={t('downloads.windows.description')}
      recommended={recommended}
      features={[
        { icon: BellRingingIcon, text: t('downloads.windows.features.notifications') },
        { icon: GameControllerIcon, text: t('downloads.windows.features.activity') },
        { icon: PowerIcon, text: t('downloads.windows.features.startup') },
        { icon: ArrowsClockwiseIcon, text: t('downloads.windows.features.updates') },
      ]}
    >
      {isDesktopApp() ? <WindowsAppInUse /> : <WindowsDownload recommended={recommended} />}
    </AppCard>
  );
}

function WindowsAppInUse() {
  const { t } = useTranslation('settings');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <StatusLine>{t('downloads.windows.inUse')}</StatusLine>
      <AppLink to={ROUTES.settingsTab('desktop')} className="rounded-sm text-label font-medium text-accent-text focus-ring hover:underline">
        {t('downloads.windows.openSettings')}
      </AppLink>
    </div>
  );
}

function WindowsDownload({ recommended }: { recommended: boolean }) {
  const { t } = useTranslation('settings');
  const { status, value, retry } = useDesktopDownloads();
  const installer = value?.files.windows;

  if (status === 'error' || (status === 'ready' && !installer)) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-start gap-2 text-label text-text-muted">
          <InfoIcon size={18} weight="fill" aria-hidden className="mt-px flex-none" />
          {t('downloads.windows.unavailable')}
        </p>
        <Button type="button" variant="secondary" onClick={retry}>{t('downloads.retry')}</Button>
      </div>
    );
  }

  const label = <><DownloadSimpleIcon weight="fill" aria-hidden />{t('downloads.windows.download')}</>;
  return (
    <div className="flex flex-col gap-3">
      {installer ? (
        <a href={installer} download className={cn(buttonVariants({ variant: recommended ? 'default' : 'secondary', size: 'lg' }), 'h-11 w-full text-body')}>
          {label}
        </a>
      ) : (
        <Button type="button" size="lg" variant={recommended ? 'default' : 'secondary'} disabled className="h-11 w-full text-body">{label}</Button>
      )}
      <p className="flex min-h-5 flex-wrap items-center justify-center gap-x-1.5 text-caption text-text-muted">
        {value ? (
          <>
            <span>{t('downloads.windows.version', { version: value.version })}</span>
            <span aria-hidden>·</span>
            <a href={value.page} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-link focus-ring hover:underline">
              {t('downloads.windows.allVersions')}
              <ArrowSquareOutIcon size={12} weight="fill" aria-hidden />
            </a>
          </>
        ) : <span className="h-3 w-32 animate-pulse rounded-full bg-fill-subtle" aria-hidden />}
      </p>
      {!recommended && <p className="text-caption text-text-muted">{t('downloads.windows.otherSystem')}</p>}
    </div>
  );
}

function WebAppCard({ recommended }: { recommended: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <AppCard
      id="web-app"
      icon={GlobeIcon}
      platforms={t('downloads.web.platforms')}
      title={t('downloads.web.title')}
      description={t('downloads.web.description')}
      recommended={recommended}
      features={[
        { icon: DeviceMobileIcon, text: t('downloads.web.features.anywhere') },
        { icon: BellRingingIcon, text: t('downloads.web.features.notifications') },
        { icon: LightningIcon, text: t('downloads.web.features.light') },
      ]}
    >
      <WebAppInstall recommended={recommended} />
    </AppCard>
  );
}

function WebAppInstall({ recommended }: { recommended: boolean }) {
  const { t } = useTranslation('settings');
  const { method, installed, install } = useInstall();

  if (isDesktopApp()) return <Hint>{t('downloads.web.fromDesktopApp')}</Hint>;
  if (installed) return <StatusLine>{t('downloads.web.installed')}</StatusLine>;
  if (method === 'prompt') {
    return (
      <Button type="button" size="lg" variant={recommended ? 'default' : 'secondary'} className="h-11 w-full text-body" onClick={() => void install()}>
        <DownloadSimpleIcon weight="fill" aria-hidden />
        {t('downloads.web.install')}
      </Button>
    );
  }
  if (method === 'ios') {
    const steps: { icon?: IconComponent; text: string }[] = [
      { icon: ExportIcon, text: t('downloads.web.ios.share') },
      { icon: PlusSquareIcon, text: t('downloads.web.ios.addToHome') },
      { text: t('downloads.web.ios.confirm') },
    ];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-label font-semibold text-text-primary">{t('downloads.web.ios.title')}</p>
        <ol className="flex flex-col gap-2.5">
          {steps.map(({ icon: Icon, text }, index) => (
            <li key={text} className="flex items-center gap-3 text-label text-text-primary">
              <span aria-hidden className="flex size-6 flex-none items-center justify-center rounded-full bg-accent-primary text-caption font-bold text-primary-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1">{text}</span>
              {Icon && <Icon size={20} aria-hidden className="flex-none text-accent-text" />}
            </li>
          ))}
        </ol>
        <p className="text-caption text-text-muted">{t('downloads.web.ios.notifications')}</p>
      </div>
    );
  }
  return <Hint>{t('downloads.web.unsupported')}</Hint>;
}

interface AppCardProps {
  /** also the search result's target (`/app/settings/downloads#web-app`) */
  id: string;
  icon: IconComponent;
  platforms: string;
  title: string;
  description: string;
  recommended: boolean;
  features: { icon: IconComponent; text: string }[];
  children: ReactNode;
}

function AppCard({ id, icon: Icon, platforms, title, description, recommended, features, children }: AppCardProps) {
  const { t } = useTranslation('settings');
  const headingId = `${id}-title`;
  return (
    <article
      id={id}
      aria-labelledby={headingId}
      // focus target for a search result, as SettingsSection is
      tabIndex={-1}
      className={cn(
        'flex scroll-mt-10 flex-col overflow-hidden rounded-xl border bg-bg-card outline-none',
        recommended ? 'border-border-accent' : 'border-border-default',
      )}
    >
      <div className="bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklch,var(--color-accent-primary)_24%,transparent),transparent_70%)] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-xl border border-border-default bg-surface-rail text-text-strong shadow-popover">
            <Icon size={26} weight="fill" />
          </span>
          {recommended && (
            <span className="rounded-full bg-accent-primary/15 px-2.5 py-1 text-caption font-semibold text-accent-text">{t('downloads.recommended')}</span>
          )}
        </div>
        <p className="mt-4 text-caption font-semibold uppercase tracking-wide text-text-muted">{platforms}</p>
        <h4 id={headingId} className="mt-1 text-heading font-bold text-text-strong">{title}</h4>
        <p className="mt-2 text-label text-text-secondary">{description}</p>
      </div>
      <ul className="flex flex-col gap-2.5 px-5 pb-5 pt-1">
        {features.map(({ icon: FeatureIcon, text }) => (
          <li key={text} className="flex items-center gap-3 text-label text-text-primary">
            <span aria-hidden className="flex size-7 flex-none items-center justify-center rounded-md bg-fill-subtle text-accent-text">
              <FeatureIcon size={16} weight="fill" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <div className="mt-auto border-t border-border-divider px-5 py-4">{children}</div>
    </article>
  );
}

function CompareRow({ icon: Icon, question, answer }: { icon: IconComponent; question: string; answer: string }) {
  return (
    <li className="flex items-start gap-4">
      <span aria-hidden className="grid size-11 flex-none place-items-center rounded-lg bg-fill-subtle text-text-primary">
        <Icon size={22} weight="fill" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-text-primary">{question}</p>
        <p className="mt-1 text-label text-text-muted">{answer}</p>
      </div>
    </li>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-label font-medium text-green">
      <CheckCircleIcon size={18} weight="fill" aria-hidden className="flex-none" />
      {children}
    </p>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-label text-text-muted">
      <InfoIcon size={18} weight="fill" aria-hidden className="mt-px flex-none" />
      {children}
    </p>
  );
}
