import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconnectBanner } from '@/app/layout/ReconnectBanner';
import { RoomContext } from '@/state/RoomContext';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

afterEach(() => vi.useRealTimers());

describe('ReconnectBanner', () => {
  it('offers manual retry after a sustained disconnect and resets the delay after recovery', () => {
    vi.useFakeTimers();
    const retryConnection = vi.fn();
    const view = (reconnecting: boolean) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ state: { ...initialRoomState, reconnecting }, retryConnection })}>
        <ReconnectBanner />
      </RoomContext.Provider>
    );
    const { rerender } = render(view(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('status')).toHaveTextContent('Sem conexão com o servidor');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar reconectar agora' }));
    expect(retryConnection).toHaveBeenCalledTimes(1);
    rerender(view(false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(view(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
