import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaygroundLoadingScreen } from '@/features/playground/PlaygroundLoadingScreen';

describe('PlaygroundLoadingScreen', () => {
  it('says what is going on, with a bar while the terrain is built', () => {
    const { rerender, container } = render(<PlaygroundLoadingScreen loading={{ phase: 'downloading', progress: 0 }} scale={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando o mundo');
    expect(screen.getByRole('status')).toHaveTextContent('Baixando o mundo');
    rerender(<PlaygroundLoadingScreen loading={{ phase: 'building', progress: 0.4 }} scale={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Construindo o terreno');
    expect(container.querySelector('[style*="width: 40%"]')).not.toBeNull();
  });

  it('tells when the game server cannot be reached', () => {
    render(<PlaygroundLoadingScreen loading={{ phase: 'unreachable', progress: 0 }} scale={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Não foi possível conectar ao servidor do jogo');
  });
});
