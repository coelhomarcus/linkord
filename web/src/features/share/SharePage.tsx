import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { queueShare } from '@/features/chat/pendingShare';
import { conversationTitle, directUser } from '@/features/conversations/conversationUtils';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { ListSearch } from '@/features/friends/ListSearch';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { ServerIcon } from '@/features/servers/ServerIcon';
import { Avatar } from '@/shared/Avatar';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { conversationPath, ROUTES } from '@/shared/lib/routes';
import { PageHeader } from '@/shared/PageHeader';
import type { Conversation } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';
import { useRoom } from '@/state/RoomContext';
import { discardSharedPayload, isShareId, readSharedPayload, type SharedPayload } from './sharedPayload';

type Load = { status: 'loading' } | { status: 'ready'; payload: SharedPayload } | { status: 'missing' } | { status: 'failed' };

/** Where the system share sheet lands: what was shared (stored by the service
 * worker) waits while you choose the conversation it goes to. */
export function SharePage() {
  const { t } = useTranslation('share');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id');
  const [load, setLoad] = useState<Load>(() => (params.get('failed') ? { status: 'failed' } : isShareId(id) ? { status: 'loading' } : { status: 'missing' }));

  useEffect(() => {
    if (!isShareId(id)) return;
    let cancelled = false;
    void readSharedPayload(id).then((payload) => {
      if (!cancelled) setLoad(payload ? { status: 'ready', payload } : { status: 'missing' });
    });
    return () => { cancelled = true; };
  }, [id]);

  const payload = load.status === 'ready' ? load.payload : null;

  function leave() {
    if (isShareId(id)) void discardSharedPayload(id);
    navigate(ROUTES.home, { replace: true });
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('title')}
        subtitle={payload ? (payload.files.length ? t('subtitle', { count: payload.files.length }) : t('subtitleText')) : undefined}
        actions={<Button type="button" variant="ghost" onClick={leave}>{t('cancel')}</Button>}
      />
      {load.status === 'loading' && <p role="status" className="px-4 py-6 text-label text-text-muted md:px-6">{t('loading')}</p>}
      {load.status === 'failed' && <p role="alert" className="mx-4 mt-3 rounded-md bg-red/12 px-3 py-2 text-label text-red-text md:mx-6">{t('failed')}</p>}
      {load.status === 'missing' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-body font-semibold text-text-strong">{t('missing.title')}</h2>
          <p className="max-w-sm text-label text-text-muted">{t('missing.body')}</p>
          <Button type="button" variant="outline" onClick={leave}>{t('missing.action')}</Button>
        </div>
      )}
      {payload && (
        <TargetPicker
          payload={payload}
          onPick={(conversation, accountId) => {
            queueShare(accountId, conversation.id, { files: payload.files, text: payload.text });
            void discardSharedPayload(payload.id);
            navigate(conversationPath(conversation), { replace: true });
          }}
        />
      )}
    </main>
  );
}

function TargetPicker({ payload, onPick }: { payload: SharedPayload; onPick: (conversation: Conversation, accountId: string) => void }) {
  const { t } = useTranslation('share');
  const { state, conversations, servers, allUsers } = useRoom();
  const [query, setQuery] = useState('');
  const accountId = state.me.userId ?? '';
  const needsFiles = payload.files.length > 0;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // the server refuses sending without SEND_MESSAGES, and attaching without ATTACH_FILES
    const writable = (c: Conversation) => c.permissions === undefined
      || (hasPermission(c.permissions, PERMISSIONS.SEND_MESSAGES) && (!needsFiles || hasPermission(c.permissions, PERMISSIONS.ATTACH_FILES)));
    const matches = (c: Conversation) => !needle || conversationTitle(c, state.me.userId, allUsers).toLowerCase().includes(needle);
    const direct = conversations
      .filter((c) => c.type === 'direct' && writable(c) && matches(c))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    const channels = servers
      .map((server) => ({
        server,
        channels: conversations.filter((c) => c.serverId === server.id && c.type === 'text' && writable(c) && matches(c)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      }))
      .filter((group) => group.channels.length > 0);
    return { direct, channels };
  }, [conversations, servers, allUsers, query, needsFiles, state.me.userId]);

  const empty = groups.direct.length === 0 && groups.channels.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 md:px-6">
      <SharedSummary payload={payload} />
      <ListSearch value={query} onChange={setQuery} label={t('search')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty && <p className="py-6 text-center text-label text-text-muted">{t('empty')}</p>}
        {groups.direct.length > 0 && (
          <section aria-labelledby="share-direct">
            <h2 id="share-direct" className="px-2 pb-1 pt-2 text-caption font-semibold uppercase text-text-muted">{t('sections.direct')}</h2>
            <ul>
              {groups.direct.map((conversation) => {
                const peer = directUser(conversation, state.me.userId, allUsers);
                const title = conversationTitle(conversation, state.me.userId, allUsers);
                return (
                  <li key={conversation.id}>
                    <TargetRow title={title} onPick={() => onPick(conversation, accountId)}>
                      {peer
                        ? <Avatar id={peer.id} name={peer.displayName} avatar={peer.avatar} avatarColor={peer.avatarColor} size={36} />
                        : <GroupAvatar id={conversation.id} title={title} size={36} />}
                    </TargetRow>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {groups.channels.map(({ server, channels }) => (
          <section key={server.id} aria-labelledby={`share-${server.id}`}>
            <h2 id={`share-${server.id}`} className="flex items-center gap-2 px-2 pb-1 pt-4 text-caption font-semibold uppercase text-text-muted">
              <ServerIcon id={server.id} name={server.name} icon={server.icon} size={20} />
              <span className="truncate">{server.name}</span>
            </h2>
            <ul>
              {channels.map((channel) => (
                <li key={channel.id}>
                  <TargetRow title={`# ${channel.title}`} onPick={() => onPick(channel, accountId)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TargetRow({ title, onPick, children }: { title: string; onPick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onPick} className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-body text-text-primary hover:bg-fill-hover focus-visible:bg-fill-hover">
      {children && <span aria-hidden className="flex flex-none">{children}</span>}
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </button>
  );
}

function SharedSummary({ payload }: { payload: SharedPayload }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-label text-text-secondary">
      {payload.text && <p className="line-clamp-3 whitespace-pre-wrap break-words">{payload.text}</p>}
      {payload.files.length > 0 && (
        <ul className={payload.text ? 'mt-2' : ''}>
          {payload.files.slice(0, 5).map((file, index) => (
            <li key={index} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="flex-none text-text-muted">{formatFileSize(file.size)}</span></li>
          ))}
          {payload.files.length > 5 && <li className="text-text-muted">+{payload.files.length - 5}</li>}
        </ul>
      )}
    </div>
  );
}
