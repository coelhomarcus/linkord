import { CircleNotchIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { sendFriendRequest } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { friendsSection } from '@/shared/lib/routes';
import { describeOutcome, describeSendError, normalizeUsernameInput } from './friendsText';
import { AppLink } from '@/shared/ui/app-link';

type Result = { text: string; tone: 'success' | 'info' | 'error'; linkToRequests?: boolean };

/** Discovery is by EXACT @username only — no catalog, no partial search
 * (docs/plano-rede-social.md §3): nothing here ever lists accounts. */
export function AddFriendForm({ onSent, autoFocus }: { onSent: () => void; autoFocus?: boolean }) {
  const { t } = useTranslation('friends');
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const username = normalizeUsernameInput(value);
    if (!username || pending) return;
    setPending(true);
    setResult(null);
    try {
      const outcome = await sendFriendRequest(username);
      setResult({ ...describeOutcome(outcome, username), linkToRequests: outcome === 'pending_received' });
      if (outcome === 'created') setValue('');
      onSent();
    } catch (err) {
      setResult({ text: describeSendError(err), tone: 'error' });
    } finally {
      setPending(false);
    }
  }

  const toneClass = result?.tone === 'error' ? 'text-red' : result?.tone === 'success' ? 'text-green' : 'text-text-muted';

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2">
      <label htmlFor="add-friend-username" className="text-body font-medium text-text-primary">{t('addFriend')}</label>
      <p className="text-label text-text-muted">{t('form.hint')}</p>
      <div className="flex gap-2">
        <Input
          id="add-friend-username"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('form.placeholder')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={40}
          className="border-input"
        />
        <Button type="submit" disabled={pending || !normalizeUsernameInput(value)} className="flex-none">
          {pending ? <CircleNotchIcon size={20} className="animate-spin" /> : <UserPlusIcon size={20} />}
          <span>{t('form.submit')}</span>
        </Button>
      </div>
      {result && (
        <p role="status" className={`text-label ${toneClass}`}>
          {result.text}
          {result.linkToRequests && <> <AppLink to={friendsSection('received')} className="underline underline-offset-2">{t('form.viewReceived')}</AppLink></>}
        </p>
      )}
    </form>
  );
}
