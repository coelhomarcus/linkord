import { useTranslation } from 'react-i18next';

/** The inline "could not load, try again" line a settings section shows in place of what it failed to fetch. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center gap-2 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="flex-none font-medium underline-offset-2 hover:underline">{t('page.retry')}</button>
    </div>
  );
}
