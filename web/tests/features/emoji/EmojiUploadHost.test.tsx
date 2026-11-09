import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiUploadHost } from '@/features/emoji/EmojiUploadHost';
import { requestEmojiUpload } from '@/features/emoji/emojiUploadRequest';

const uploadServerEmoji = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/features/emoji/serverEmojisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/emoji/serverEmojisApi')>()),
  uploadServerEmoji,
}));

// the real cropper measures the image; this one reports a crop at once so Save is enabled
function FakeCropper({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) {
  // once, on mount: the dialog passes a new callback every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 10, height: 10 }); }, []);
  return <div data-testid="cropper" />;
}
vi.mock('react-easy-crop', () => ({ default: FakeCropper }));

function pickFile(size: number) {
  const file = new File(['x'], 'party.gif', { type: 'image/gif' });
  Object.defineProperty(file, 'size', { value: size });
  act(() => { requestEmojiUpload('server-1', new Set()); });
  fireEvent.change(screen.getByTestId('emoji-upload-input'), { target: { files: [file] } });
}

describe('EmojiUploadHost', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:emoji', revokeObjectURL: () => {} }));
    HTMLInputElement.prototype.click = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    uploadServerEmoji.mockClear();
  });

  it('says a file is too large as soon as it is picked, and never sends it', async () => {
    render(<EmojiUploadHost />);
    pickFile(13 * 1024 * 1024);

    expect(screen.getByRole('alert')).toHaveTextContent('Arquivo muito grande (máximo 12MB).');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvar' }));
    expect(uploadServerEmoji).not.toHaveBeenCalled();
  });

  it('sends a file within the limit', async () => {
    render(<EmojiUploadHost />);
    pickFile(2 * 1024 * 1024);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salvar' }));
    expect(uploadServerEmoji).toHaveBeenCalledOnce();
  });
});
