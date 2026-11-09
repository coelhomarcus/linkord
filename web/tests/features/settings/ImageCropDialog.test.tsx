import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageCropDialog } from '@/features/settings/ImageCropDialog';

vi.mock('react-easy-crop', () => ({
  default: () => <div data-testid="cropper" />,
}));

describe('ImageCropDialog', () => {
  it('shows a blocking processing state while the image is being prepared', () => {
    render(
      <ImageCropDialog
        open
        imageSrc="blob:photo"
        aspect={1}
        cropShape="round"
        title="Recortar foto de perfil"
        processing
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Processando imagem…');
    expect(screen.getByText('Enviando e recortando a imagem. GIFs animados podem levar alguns segundos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows a processing error without losing the crop dialog', () => {
    render(
      <ImageCropDialog
        open
        imageSrc="blob:photo"
        aspect={1}
        cropShape="round"
        title="Recortar foto de perfil"
        error="Falha ao processar a imagem."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao processar a imagem.');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  // a `relative` here once replaced the dialog's `fixed` centering, leaving
  // it pinned near the top of the screen
  it('stays centered on the screen like every other dialog', () => {
    render(
      <ImageCropDialog open imageSrc="blob:photo" aspect={1} cropShape="rect" title="Recortar ícone do servidor" onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('fixed', 'top-1/2', 'left-1/2', '-translate-y-1/2');
    expect(dialog).not.toHaveClass('relative');
  });
});
