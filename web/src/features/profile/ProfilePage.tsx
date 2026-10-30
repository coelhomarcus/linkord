import { GearIcon, UserCircleIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { PageHeader } from '@/shared/PageHeader';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';

export function ProfilePage({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { state } = useRoom();
  const navigate = useNavigate();
  const me = state.me;
  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader title="Perfil" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-secondary p-4">
            <Avatar id={me.userId ?? me.id ?? 'me'} name={me.displayName} avatar={me.avatar} avatarColor={me.avatarColor} size={64} />
            <div className="min-w-0">
              <h2 className="truncate text-title font-semibold">{me.displayName}</h2>
              <p className="truncate text-label text-text-muted">@{me.name}</p>
            </div>
          </div>
          <nav aria-label="Opções do perfil" className="overflow-hidden rounded-xl border border-border bg-bg-secondary">
            <button type="button" onClick={() => { if (me.userId) onOpenProfile(me.userId); }} className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left text-label hover:bg-fill-hover">
              <UserCircleIcon size={22} aria-hidden /> Meu perfil
            </button>
            <button type="button" onClick={() => navigate(ROUTES.settings)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-label hover:bg-fill-hover">
              <GearIcon size={22} aria-hidden /> Ajustes
            </button>
          </nav>
        </div>
      </div>
    </main>
  );
}
