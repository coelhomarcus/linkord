import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconnectBanner } from '@/app/layout/ReconnectBanner';
import { RoomContext } from '@/state/RoomContext';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

afterEach(() => vi.useRealTimers());

describe('ReconnectBanner', () => {
  it('tells the user to reload after a sustained disconnect and resets the delay after recovery', () => {
    vi.useFakeTimers();
    const view = (reconnecting: boolean) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ state: { ...initialRoomState, reconnecting } })}>
        <ReconnectBanner />
      </RoomContext.Provider>
    );
    const { rerender } = render(view(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('status')).toHaveTextContent('Sem conexão com o servidor. Aperte F5 para recarregar a página.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(view(false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(view(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
