import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyIdButton } from './CopyIdButton';

/** Who or what an admin detail page is about: an avatar, a name, a secondary
 * line, the badges that say its state, and the id — copyable, and breakable so
 * a long one never widens the page. */
export function AdminEntityHeader({ avatar, title, subtitle, id, badges }: {
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  id: string;
  badges?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  return (
    <header className="admin-panel admin-card-inset flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-4">
        <div className="shrink-0">{avatar}</div>
        <div className="min-w-0 flex-1">
          <h1 className="admin-page-heading">{title}</h1>
          {subtitle && <p className="mt-1 wrap-anywhere text-label text-text-muted">{subtitle}</p>}
          <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md bg-fill-subtle pl-2 text-caption text-text-muted">
            <code className="min-w-0 wrap-anywhere">{id}</code>
            <CopyIdButton id={id} label={t('ui.copyId', { name: title })} />
          </div>
        </div>
      </div>
      {badges && <div className="flex min-w-0 flex-wrap items-center gap-2">{badges}</div>}
    </header>
  );
}
