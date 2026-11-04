import { FlagIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { ApiError, submitReport } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { i18n } from '@/shared/i18n/init';
import { MAX_REPORT_DETAILS, REPORT_CATEGORIES } from './reportCategories';
import type { ReportCategory, ReportTarget } from './reportCategories';

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return i18n.t('reports:errors.rateLimited');
    if (err.status === 404) return i18n.t('reports:errors.notFound');
  }
  return i18n.t('reports:errors.submitFailed');
}

/** Files a report about an account, a server or a message. The confirmation is
 * deliberately neutral: it says nothing about what happens next or who else
 * was told — the reported account never learns who reported. */
export function ReportDialog({ target, open, onOpenChange }: {
  target: ReportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('reports');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setCategory(null);
    setDetails('');
    setStatus('idle');
    setError(null);
  }

  async function submit() {
    if (!target || !category || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      await submitReport({ targetType: target.type, targetId: target.id, category, details: details.trim() });
      setStatus('sent');
    } catch (err) {
      setError(describeError(err));
      setStatus('idle');
    }
  }

  const noun = target?.type === 'user' ? t('targets.user') : target?.type === 'server' ? t('targets.server') : t('targets.message');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-md p-0 text-text-primary">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <FlagIcon size={17} />
            {t('dialog.title', { target: noun })}
          </DialogTitle>
        </DialogHeader>
        {status === 'sent' ? (
          <div className="px-5 py-6 text-body text-text-secondary">
            <p className="font-medium text-text-primary">{t('dialog.sentTitle')}</p>
            <p className="mt-1 text-label text-text-muted">{t('dialog.sentDescription')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-label text-text-muted">
              {target ? <>{t('dialog.about')} <span className="font-medium text-text-secondary">{target.label}</span>. </> : null}
              {t('dialog.confidential')}
            </p>
            <div role="radiogroup" aria-label={t('dialog.reason')} className="flex flex-col gap-1">
              {REPORT_CATEGORIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={category === option.value}
                  onClick={() => setCategory(option.value)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-label transition-colors',
                    category === option.value ? 'bg-primary/12 text-text-primary' : 'text-text-secondary hover:bg-fill-hover',
                  )}
                >
                  <span className={cn('grid size-4 place-items-center rounded-full border', category === option.value ? 'border-primary' : 'border-border-strong')}>
                    {category === option.value && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  {t(`categories.${option.value}`)}
                </button>
              ))}
            </div>
            <Textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={MAX_REPORT_DETAILS}
              rows={3}
              placeholder={t('dialog.detailsPlaceholder')}
              aria-label={t('dialog.detailsLabel')}
              className="resize-none border-border bg-fill-subtle"
            />
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-border px-5 py-4">
          {status === 'sent' ? (
            <Button type="button" onClick={close}>{t('dialog.close')}</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>{t('dialog.cancel')}</Button>
              <Button type="button" onClick={() => void submit()} disabled={!category || status === 'sending'}>
                {status === 'sending' ? t('dialog.sending') : t('dialog.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
