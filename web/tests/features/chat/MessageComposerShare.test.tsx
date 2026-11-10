import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { clearPendingShares, queueShare } from '@/features/chat/pendingShare';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation } from '@/shared/types/protocol';
import { fileName } from '@tests/fixtures/fileNameMatcher';
import { fieldValue } from '@tests/fixtures/messageFieldFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

const joinedState = { ...initialRoomState, joined: true };

afterEach(() => {
  clearAllDrafts();
  clearPendingShares();
});

describe('a share waiting for the composer', () => {
  it('lands in the chosen conversation as text and attachments, once', async () => {
    queueShare('', 'conv-1', { text: 'olha isso', files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] });

    const { unmount } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    expect(fieldValue(screen.getByRole('textbox'))).toBe('olha isso');
    expect(await screen.findByText(fileName('doc.pdf'))).toBeInTheDocument();

    // the composer coming back later must not attach it a second time
    unmount();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    expect(screen.getAllByText(fileName('doc.pdf'))).toHaveLength(1);
  });

  it('leaves other conversations alone', () => {
    queueShare('', 'conv-2', { text: 'so para a dois', files: [] });

    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    expect(fieldValue(screen.getByRole('textbox'))).toBe('');
  });

  it('keeps the text and drops the files where the channel does not allow attachments', async () => {
    const channel: Conversation = {
      id: 'ch-1', type: 'text', title: 'geral', memberIds: [], serverId: 's1', lastMessageAt: null, createdAt: 0, updatedAt: 0,
      permissions: PERMISSIONS.SEND_MESSAGES,
    };
    queueShare('', 'ch-1', { text: 'oi', files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] });

    renderWithRoom(<MessageComposer conversationId="ch-1" />, { state: joinedState, conversations: [channel] });

    expect(fieldValue(screen.getByRole('textbox'))).toBe('oi');
    await act(async () => {});
    expect(screen.queryByText(fileName('doc.pdf'))).not.toBeInTheDocument();
  });
});
