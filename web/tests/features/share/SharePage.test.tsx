import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeShare, clearPendingShares } from '@/features/chat/pendingShare';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { SharePage } from '@/features/share/SharePage';
import { SHARE_CACHE } from '@/features/share/sharedPayload';
import type { Conversation, PublicUser, ServerSummary } from '@/shared/types/protocol';
import { initialRoomState } from '@/state/roomReducer';
import { FakeCacheStorage } from '@tests/fixtures/fakeCacheStorage';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const origin = window.location.origin;

const ana = { id: 'u2', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: '' } as PublicUser;
const conversation = (overrides: Partial<Conversation>): Conversation => ({
  id: 'c', type: 'text', title: 'geral', memberIds: [], serverId: 's1', lastMessageAt: null, createdAt: 0, updatedAt: 0, position: 0, ...overrides,
});
const dm = conversation({ id: 'dm-1', type: 'direct', title: '', memberIds: ['me', 'u2'], serverId: null });
const open = conversation({ id: 'ch-open', title: 'geral', permissions: PERMISSIONS.SEND_MESSAGES | PERMISSIONS.ATTACH_FILES });
const noFiles = conversation({ id: 'ch-text', title: 'so-texto', position: 1, permissions: PERMISSIONS.SEND_MESSAGES });
const readOnly = conversation({ id: 'ch-ro', title: 'avisos', position: 2, permissions: 0 });
const server = { id: 's1', name: 'Casa', icon: '' } as ServerSummary;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPage(search: string) {
  return renderWithRoom(
    <MemoryRouter initialEntries={[`/app/share${search}`]}>
      <Routes>
        <Route path="/app/share" element={<SharePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
    {
      state: { ...initialRoomState, joined: true, me: { ...initialRoomState.me, userId: 'me' } },
      conversations: [dm, open, noFiles, readOnly],
      servers: [server],
      allUsers: new Map([['u2', ana]]),
    },
  );
}

async function storeShare(meta: { text?: string; files?: Array<{ name: string; type: string; body: string }> }) {
  const caches = new FakeCacheStorage();
  vi.stubGlobal('caches', caches);
  const cache = await caches.open(SHARE_CACHE);
  const files = meta.files ?? [];
  await cache.put(`${origin}/share-target/${ID}/meta`, new Response(JSON.stringify({
    createdAt: Date.now(), title: '', text: meta.text ?? '', url: '', files: files.map(({ name, type }) => ({ name, type, lastModified: 0 })),
  })));
  for (const [index, file] of files.entries()) await cache.put(`${origin}/share-target/${ID}/file/${index}`, new Response(file.body));
  return caches;
}

describe('SharePage', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPendingShares();
  });

  it('lists the DMs and the channels that accept what was shared', async () => {
    await storeShare({ files: [{ name: 'doc.pdf', type: 'application/pdf', body: 'x' }] });
    renderPage(`?id=${ID}`);

    expect(await screen.findByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '# geral' })).toBeInTheDocument();
    // a channel without ATTACH_FILES or without SEND_MESSAGES cannot take a file
    expect(screen.queryByRole('button', { name: '# so-texto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '# avisos' })).not.toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
  });

  it('offers a channel that only allows messages when only text was shared', async () => {
    await storeShare({ text: 'um link' });
    renderPage(`?id=${ID}`);

    expect(await screen.findByRole('button', { name: '# so-texto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '# avisos' })).not.toBeInTheDocument();
  });

  it('queues the share for the chosen conversation, opens it and clears the stored copy', async () => {
    const user = userEvent.setup();
    const caches = await storeShare({ text: 'olha', files: [{ name: 'doc.pdf', type: 'application/pdf', body: 'x' }] });
    renderPage(`?id=${ID}`);

    await user.click(await screen.findByRole('button', { name: '# geral' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/app/channels/s1/ch-open');
    const share = takeShare('me', 'ch-open');
    expect(share?.text).toBe('olha');
    expect(share?.files.map((file) => file.name)).toEqual(['doc.pdf']);
    await waitFor(() => expect(caches.entries(SHARE_CACHE)).toEqual([]));
  });

  it('filters by the typed name', async () => {
    const user = userEvent.setup();
    await storeShare({ text: 'oi' });
    renderPage(`?id=${ID}`);

    await user.type(await screen.findByRole('textbox', { name: 'Buscar conversa ou canal' }), 'ana');

    expect(screen.getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '# geral' })).not.toBeInTheDocument();
  });

  it('explains an expired share and goes home', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('caches', new FakeCacheStorage());
    renderPage(`?id=${ID}`);

    expect(await screen.findByText('Nada para enviar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ir para o início' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/channels/@me');
  });

  it('tells the user when the worker could not store the share', () => {
    renderPage('?failed=1');
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível receber');
  });

  it('cancel removes the stored files', async () => {
    const user = userEvent.setup();
    const caches = await storeShare({ files: [{ name: 'doc.pdf', type: 'application/pdf', body: 'x' }] });
    renderPage(`?id=${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(caches.entries(SHARE_CACHE)).toEqual([]));
    expect(takeShare('me', 'ch-open')).toBeNull();
  });
});
