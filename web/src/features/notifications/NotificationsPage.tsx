import { ChecksIcon, TrashIcon } from '@phosphor-icons/react';
import { PageHeader } from '@/shared/PageHeader';
import { Button } from '@/shared/ui/primitives/button';
import { NotificationList } from './NotificationList';
import { useNotificationActions } from './useNotificationActions';

export function NotificationsPage() {
  const { unread, error, dismiss, select, markAll, clearAll } = useNotificationActions();
  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Notificações"
        actions={(
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="Marcar todas como lidas" disabled={unread === 0} onClick={markAll}><ChecksIcon size={20} /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Limpar tudo" onClick={clearAll}><TrashIcon size={20} /></Button>
          </div>
        )}
      />
      {error && <p role="alert" className="mx-4 mt-3 rounded-md bg-red/12 px-3 py-2 text-label text-red-text">Não foi possível atualizar. Tente de novo.</p>}
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2 md:px-6"><NotificationList fullPage onSelect={select} onDismiss={dismiss} /></div>
    </main>
  );
}
