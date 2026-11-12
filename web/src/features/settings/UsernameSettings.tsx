import { CheckCircleIcon, CircleNotchIcon, ShieldCheckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/state/AuthContext';
import { useRoom } from '@/state/RoomContext';
import { ApiError, changeUsername } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { i18n } from '@/shared/i18n/init';
import { MAX_USERNAME_LEN, MIN_USERNAME_LEN } from '@/features/auth/credentialRules';
import { FloatingBar } from '@/shared/FloatingBar';
import { useSaveBar } from '@/shared/hooks/useSaveBar';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { SETTINGS_ACTION_BUTTON, SETTINGS_INLINE_PANEL, SettingsRow } from '@/shared/ui/settings-layout';
import { useUsernameAvailability } from './useUsernameAvailability';

function describeSaveError(err: unknown): string {
  if (err instanceof ApiError && err.code === ERROR_CODES.username_taken) return i18n.t('settings:account.username.errors.taken');
  if (err instanceof ApiError && err.code === ERROR_CODES.invalid_username) {
    return i18n.t('settings:account.username.errors.invalid', { min: MIN_USERNAME_LEN, max: MAX_USERNAME_LEN });
  }
  return describeApiError(err, 'settings:account.username.errors.saveFailed');
}

/** The login name, changed in place: what is typed is checked for availability as it is typed, and the change
 * is saved through the floating bar with the current password. Sessions stay signed in; the new name is what
 * signs in from then on. */
export function UsernameSettings() {
  const { t } = useTranslation('settings');
  const { state, dispatch } = useRoom();
  const { refresh } = useAuth();
  const current = state.me.name;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [password, setPassword] = useState('');
  const messageId = useId();
  const name = draft.trim();
  const dirty = open && name !== current;
  const availability = useUsernameAvailability(open ? draft : '', current);
  const bar = useSaveBar({ username: name }, dirty);
  // A failed check (rate limited, offline) does not block the save: the server checks the name again anyway.
  const canSave = dirty && (availability.status === 'available' || availability.status === 'error') && password.length > 0;

  function startEdit() {
    setDraft(current);
    setPassword('');
    bar.clearError();
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setDraft('');
    setPassword('');
    bar.clearError();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    await bar.save(async () => {
      try {
        const { user } = await changeUsername(name, password);
        dispatch({ type: 'SET_LOCAL_USERNAME', name: user.username });
        setOpen(false);
        setPassword('');
        void refresh();
      } catch (err) {
        if (err instanceof ApiError && err.code === ERROR_CODES.username_taken) availability.markTaken(name);
        throw err;
      }
    }, describeSaveError);
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <SettingsRow label={t('account.username.label')} description={t('account.username.description')}>
        {state.me.role === 'admin' && (
          <span className="flex w-fit items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-accent-text">
            <ShieldCheckIcon size={16} aria-hidden /> {t('account.admin')}
          </span>
        )}
        <span className="select-text break-all text-body font-medium text-text-primary">{current}</span>
        {!open && (
          <Button type="button" variant="secondary" size="lg" className={SETTINGS_ACTION_BUTTON} aria-label={t('account.username.edit')} onClick={startEdit}>
            {t('account.edit')}
          </Button>
        )}
      </SettingsRow>
      {open && (
        <div className={`flex flex-col gap-3 ${SETTINGS_INLINE_PANEL}`}>
          <div>
            <Label htmlFor="accountUsername" className="text-label text-text-muted">{t('account.username.newLabel')}</Label>
            <Input
              id="accountUsername"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              maxLength={MAX_USERNAME_LEN}
              value={draft}
              aria-describedby={messageId}
              aria-invalid={availability.status === 'invalid' || availability.status === 'taken' || undefined}
              onChange={(event) => { setDraft(event.target.value); bar.clearError(); }}
            />
            <p id={messageId} aria-live="polite" className="mt-1.5 min-h-5 text-label">
              <AvailabilityMessage status={availability.status} error={availability.error} name={name} />
            </p>
          </div>
          <div>
            <Label htmlFor="accountUsernamePassword" className="text-label text-text-muted">{t('account.username.passwordLabel')}</Label>
            <Input
              id="accountUsernamePassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); bar.clearError(); }}
            />
          </div>
          <p className="text-label text-text-muted">{t('account.username.sessionsNote')}</p>
          <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={bar.status === 'saving'} onClick={close}>
            <span>{t('account.username.cancel')}</span>
          </Button>
        </div>
      )}
      <FloatingBar
        open={bar.visible}
        label={t('account.username.barLabel')}
        status={bar.status}
        error={bar.error}
        saveDisabled={!canSave}
        onReset={dirty ? () => { setDraft(current); bar.clearError(); } : undefined}
      />
    </form>
  );
}

function AvailabilityMessage({ status, error, name }: { status: ReturnType<typeof useUsernameAvailability>['status']; error: string | null; name: string }) {
  const { t } = useTranslation('settings');
  switch (status) {
    case 'checking':
      return (
        <span className="flex items-center gap-1.5 text-text-muted">
          <CircleNotchIcon size={16} className="animate-spin" aria-hidden /> {t('account.username.checking')}
        </span>
      );
    case 'available':
      return (
        <span className="flex items-center gap-1.5 text-green">
          <CheckCircleIcon size={16} aria-hidden /> {t('account.username.available', { username: name })}
        </span>
      );
    case 'taken':
      return (
        <span className="flex items-center gap-1.5 text-red-text">
          <WarningCircleIcon size={16} className="text-red" aria-hidden /> {t('account.username.errors.taken')}
        </span>
      );
    case 'invalid':
      return <span className="text-red-text">{t('account.username.errors.invalid', { min: MIN_USERNAME_LEN, max: MAX_USERNAME_LEN })}</span>;
    case 'error':
      return <span className="text-red-text">{error}</span>;
    default:
      return <span className="text-text-muted">{t('account.username.rules', { min: MIN_USERNAME_LEN, max: MAX_USERNAME_LEN })}</span>;
  }
}
