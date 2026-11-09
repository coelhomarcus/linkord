import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StickerEditorDialog } from '@/features/stickers/StickerEditorDialog';
import type { ServerSticker } from '@/features/stickers/stickersApi';

const sticker: ServerSticker = {
  id: 'a'.repeat(32), name: 'abraço', description: '', emoji: '🤗', animated: false, createdAt: 0, uploader: null,
};

afterEach(() => vi.restoreAllMocks());

describe('StickerEditorDialog', () => {
  it('needs a file, a related emoji and a name before uploading', () => {
    render(<StickerEditorDialog serverId="s1" open onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Enviar figurinha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('refuses a file over the limit before sending anything', async () => {
    render(<StickerEditorDialog serverId="s1" open onOpenChange={() => {}} />);
    const big = new File(['x'], 'grande.gif', { type: 'image/gif' });
    Object.defineProperty(big, 'size', { value: 13 * 1024 * 1024 });
    await userEvent.upload(screen.getByTestId('sticker-file-input'), big);
    expect(screen.getByRole('alert')).toHaveTextContent('Arquivo muito grande');
  });

  it('saves the edited details of an existing sticker', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ sticker: { ...sticker, name: 'abraço forte' } }), { headers: { 'Content-Type': 'application/json' } }));
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<StickerEditorDialog serverId="s1" sticker={sticker} open onOpenChange={onOpenChange} onSaved={onSaved} />);
    const name = screen.getByRole('textbox', { name: /Nome da figurinha/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'abraço forte');
    await userEvent.type(screen.getByRole('textbox', { name: 'Descrição' }), 'dois gatos');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(`/api/servers/s1/stickers/${sticker.id}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'abraço forte', emoji: '🤗', description: 'dois gatos' });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
