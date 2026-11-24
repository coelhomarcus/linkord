import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { PlaygroundMenu } from '@/features/playground/PlaygroundMenu';
import type { PlaygroundSession } from '@/features/playground/playgroundSession';

const session = {
  onSkinsChange: () => () => {},
  skinOf: () => null,
  setLocalSkin: vi.fn(),
} as unknown as PlaygroundSession;

function renderMenu(onResume = vi.fn(), overrides = {}) {
  renderWithRoom(
    <PlaygroundMenu
      session={session}
      localId="conn-me"
      localUserId="me"
      players={[{ id: 'conn-me', userId: 'me', name: 'Eu', speaking: false }, { id: 'conn-bia', userId: 'bia', name: 'Bia', speaking: true }]}
      presenterId="conn-bia"
      cameraMode="third"
      onToggleView={() => {}}
      onResume={onResume}
    />,
    overrides,
  );
  return onResume;
}

describe('PlaygroundMenu', () => {
  it('opens on "back to the game" and lists who is on the island', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Voltar ao jogo' })).toHaveFocus();
    expect(screen.getByText('Na ilha (2)')).toBeInTheDocument();
    expect(screen.getByText('no telão')).toBeInTheDocument();
  });

  it('moves between entries with the arrows and goes back with Esc', () => {
    const onResume = renderMenu();
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    // past the first entry it wraps around to the last one
    expect(screen.getByRole('button', { name: 'Escolher arquivo .png' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('drives the call from its entries', () => {
    const activateMic = vi.fn();
    renderMenu(vi.fn(), { activateMic });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar microfone' }));
    expect(activateMic).toHaveBeenCalledTimes(1);
  });
});
