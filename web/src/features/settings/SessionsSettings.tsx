import { DesktopIcon, DeviceMobileIcon, SignOutIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { endOtherSessions, endSession } from '@/shared/api/api';
import type { AccountSession } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { formatTime } from '@/shared/lib/formatChatTime';
import { Button } from '@/shared/ui/primitives/button';
import { SETTINGS_ACTION_BUTTON } from '@/shared/ui/settings-layout';
import { describeUserAgent } from './describeUserAgent';

/** The account's signed-in browsers, this one first. Ending one signs that browser out on the spot (the
 * server cuts its socket too). */
export function SessionsSettings({ sessions, onEnded }: { sessions: AccountSession[]; onEnded: (ids: string[]) => void }) {
  const { t } = useTranslation('settings');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
  const others = sessions.filter((s) => !s.current);

  async function end(id: string) {
    setError(null);
    setPendingId(id);
    try {
      await endSession(id);
      onEnded([id]);
    } catch (err) {
      setError(describeApiError(err, 'settings:security.sessions.endFailed'));
    } finally {
      setPendingId(null);
    }
  }

  async function endAll() {
    setError(null);
    setPendingId('all');
    try {
      await endOtherSessions();
      onEnded(others.map((s) => s.id));
    } catch (err) {
      setError(describeApiError(err, 'settings:security.sessions.endFailed'));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-label text-red-text">{error}</p>}
      <ul aria-label={t('catalog.sections.sessions')} className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {ordered.map((session) => {
          const device = describeUserAgent(session.userAgent);
          const name = device.automated
            ? t('security.sessions.automated')
            : device.browser && device.os
              ? t('security.sessions.browserOn', { browser: device.browser, os: device.os })
              : device.browser ?? (device.os ? t('security.sessions.unknownBrowserOn', { os: device.os }) : t('security.sessions.unknownDevice'));
          const Icon = device.mobile ? DeviceMobileIcon : DesktopIcon;
          return (
            <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <Icon size={28} aria-hidden className="flex-none text-text-muted" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-body font-medium text-text-primary">
                  <span className="break-words" title={session.userAgent || undefined}>{name}</span>
                  {session.current && (
                    <span className="rounded-sm bg-green/15 px-1.5 py-0.5 text-caption font-medium text-green">{t('security.sessions.current')}</span>
                  )}
                </p>
                <p className="text-label text-text-muted">
                  {[
                    session.ip && session.ip !== '?' ? session.ip : null,
                    session.current ? t('security.sessions.activeNow') : t('security.sessions.lastSeen', { time: formatTime(Date.parse(session.lastSeenAt)) }),
                  ].filter(Boolean).join(' · ')}
                </p>
                <p className="text-caption text-text-muted">{t('security.sessions.createdAt', { time: formatTime(Date.parse(session.createdAt)) })}</p>
              </div>
              {!session.current && (
                <Button
                  type="button"
                  variant="danger-outline"
                  size="sm"
                  disabled={pendingId !== null}
                  aria-label={t('security.sessions.endNamed', { name })}
                  onClick={() => void end(session.id)}
                >
                  <SignOutIcon size={16} aria-hidden />
                  <span>{t('security.sessions.end')}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 ? (
        <Button type="button" variant="danger-outline" size="lg" className={`w-fit ${SETTINGS_ACTION_BUTTON}`} disabled={pendingId !== null} onClick={() => setConfirmAll(true)}>
          <SignOutIcon size={18} aria-hidden />
          <span>{t('security.sessions.endOthers')}</span>
        </Button>
      ) : (
        <p className="text-label text-text-muted">{t('security.sessions.onlyThis')}</p>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('security.sessions.endOthersTitle')}
        description={t('security.sessions.endOthersDescription', { count: others.length })}
        confirmLabel={t('security.sessions.endOthers')}
        destructive
        onConfirm={() => void endAll()}
      />
    </div>
  );
}
