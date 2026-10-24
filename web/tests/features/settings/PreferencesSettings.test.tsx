import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { PreferencesSettings } from '@/features/settings/PreferencesSettings';

function renderPreferences(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <PreferencesSettings />
    </RoomContext.Provider>,
  );
}

describe('PreferencesSettings', () => {
  it('shows theme choices and call/upload toggles with each control\'s real state', () => {
    renderPreferences({
      colorTheme: 'whatsapp',
      showTileBanners: true,
      hideAudioOnlyTiles: true,
      showStats: false,
      compressImagesDefault: false,
    });

    expect(screen.getByRole('combobox', { name: 'Tema de cores' })).toHaveTextContent('Meia-noite');
    expect(screen.getByRole('switch', { name: 'Mostrar banners nos tiles' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Ocultar participantes sem vídeo' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mostrar estatísticas' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Compactar imagens por padrão' })).not.toBeChecked();
  });

  it('selecting a color theme calls setColorTheme and updates data-theme', async () => {
    const setColorTheme = vi.fn((id: string) => {
      document.documentElement.dataset.theme = id;
    });
    const user = userEvent.setup();
    renderPreferences({ colorTheme: 'linkord', setColorTheme });

    await user.click(screen.getByRole('combobox', { name: 'Tema de cores' }));
    await user.click(await screen.findByRole('option', { name: 'Grafite' }));
    expect(setColorTheme).toHaveBeenCalledWith('discord');
    expect(document.documentElement.dataset.theme).toBe('discord');
  });

  it('hiding audio-only participants calls the room settings setter', async () => {
    const setHideAudioOnlyTiles = vi.fn();
    const user = userEvent.setup();
    renderPreferences({ hideAudioOnlyTiles: false, setHideAudioOnlyTiles });

    await user.click(screen.getByRole('switch', { name: 'Ocultar participantes sem vídeo' }));
    // the Switch primitive itself calls onCheckedChange with (checked, eventDetails)
    expect(setHideAudioOnlyTiles.mock.calls[0]?.[0]).toBe(true);
  });

  it('compressing images by default calls the setter shared with the composer', async () => {
    const setCompressImagesDefault = vi.fn();
    const user = userEvent.setup();
    renderPreferences({ compressImagesDefault: true, setCompressImagesDefault });

    await user.click(screen.getByRole('switch', { name: 'Compactar imagens por padrão' }));
    expect(setCompressImagesDefault.mock.calls[0]?.[0]).toBe(false);
  });
});
