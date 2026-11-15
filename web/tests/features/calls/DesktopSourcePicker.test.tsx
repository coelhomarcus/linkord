import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { DesktopSourcePicker } from '@/features/calls/DesktopSourcePicker';
import { chooseDesktopSource } from '@/features/calls/desktopCapture';
import type { DesktopScreenShare, DesktopSource } from '@/shared/desktop';

const SCREENS: DesktopSource[] = [
  { id: 'screen:1:0', name: 'Screen 1', kind: 'screen', thumbnail: 'data:image/png;base64,AA==', appIcon: null },
  { id: 'screen:2:0', name: 'Screen 2', kind: 'screen', thumbnail: null, appIcon: null },
];
const EDITOR: DesktopSource = { id: 'window:42:0', name: 'Editor', kind: 'window', thumbnail: null, appIcon: 'data:image/png;base64,AA==' };

function fakeShare(sources: DesktopSource[], systemAudio = false) {
  const select = vi.fn(async () => true);
  const share: DesktopScreenShare = { picker: 'app', systemAudio, listSources: async () => sources, select };
  return { share, select };
}

async function openPicker(share: DesktopScreenShare) {
  renderWithRoom(<DesktopSourcePicker />);
  let chosen!: Promise<boolean>;
  await act(async () => { chosen = chooseDesktopSource(share); });
  await screen.findByRole('dialog', { name: 'Compartilhar tela' });
  // wrapped: an async function returning the promise would wait for the pick
  return { chosen };
}

describe('DesktopSourcePicker', () => {
  it('names the screens by number and shares the selected window with the computer sound', async () => {
    const user = userEvent.setup();
    const { share, select } = fakeShare([...SCREENS, EDITOR], true);
    const { chosen } = await openPicker(share);

    expect(screen.getByRole('button', { name: 'Tela 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tela 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Janelas' }));
    await user.click(screen.getByRole('button', { name: 'Editor' }));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Compartilhar' }));

    await expect(chosen).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith('window:42:0', true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no sound switch where the desktop app cannot capture it, and calls a lone screen the entire screen', async () => {
    const user = userEvent.setup();
    const { share, select } = fakeShare([SCREENS[0]!]);
    const { chosen } = await openPicker(share);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.dblClick(screen.getByRole('button', { name: 'Tela inteira' }));

    await expect(chosen).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith('screen:1:0', false);
  });

  it('cancelling shares nothing', async () => {
    const user = userEvent.setup();
    const { share, select } = fakeShare(SCREENS);
    const { chosen } = await openPicker(share);

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    await expect(chosen).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('says so when there is no window to share', async () => {
    const user = userEvent.setup();
    const { share } = fakeShare(SCREENS);
    await openPicker(share);

    await user.click(screen.getByRole('tab', { name: 'Janelas' }));

    expect(screen.getByText('Nenhuma janela para compartilhar.')).toBeInTheDocument();
  });
});
