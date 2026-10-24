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
    expect(screen.getByText('Preparando a imagem para o upload. GIFs animados podem levar alguns segundos.')).toBeInTheDocument();
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
});
