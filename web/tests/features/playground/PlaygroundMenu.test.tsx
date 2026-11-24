import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { PlaygroundMenu } from '@/features/playground/PlaygroundMenu';
import { QUIET } from '@/features/playground/engine/nameplate';
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
      players={[{ ...QUIET, id: 'conn-me', userId: 'me', name: 'Eu' }, { ...QUIET, id: 'conn-bia', userId: 'bia', name: 'Bia', speaking: true, presenting: true }]}
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
  it('opens on "back to the game"', () => {
    renderMenu();
    expect(screen.getByRole('dialog', { name: 'Menu do jogo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar ao jogo' })).toHaveFocus();
  });

  it('moves between buttons with the arrows, wrapping around, and goes back to the game with Esc', () => {
    const onResume = renderMenu();
    const dialog = screen.getByRole('dialog', { name: 'Menu do jogo' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    const items = dialog.querySelectorAll('[data-menu-item]');
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('puts the microphone, the sound and the big screen in a dock, with no devices or fullscreen-when-playing', () => {
    renderMenu();
    const dock = screen.getByRole('group', { name: 'Chamada' });
    const switches = [...dock.querySelectorAll('button')];
    expect(switches).toHaveLength(3);
    expect(switches[0]).toHaveAccessibleName('Ativar microfone');
    expect(switches[0]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Dispositivos')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tela cheia ao jogar/)).not.toBeInTheDocument();
  });

  it('lists who is on the island on a page of its own, and Esc comes back to the menu', () => {
    const onResume = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Jogadores (2)...' }));
    const page = screen.getByRole('dialog', { name: 'Na ilha (2)' });
    expect(screen.getByText('Bia')).toBeInTheDocument();
    expect(screen.getByText('no telão')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluído' })).toHaveFocus();
    fireEvent.keyDown(page, { key: 'Escape' });
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Voltar ao jogo' })).toHaveFocus();
  });

  it('opens the skin page, starting on choosing a file', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Skin...' }));
    expect(screen.getByRole('dialog', { name: 'Sua skin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher arquivo .png' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Concluído' }));
    expect(screen.getByRole('button', { name: 'Voltar ao jogo' })).toHaveFocus();
  });

  it('drives the call from its buttons', () => {
    const activateMic = vi.fn();
    renderMenu(vi.fn(), { activateMic });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar microfone' }));
    expect(activateMic).toHaveBeenCalledTimes(1);
  });
});
