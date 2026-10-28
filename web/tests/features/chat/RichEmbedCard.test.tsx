import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichEmbedCard } from '@/features/chat/RichEmbedCard';

describe('RichEmbedCard', () => {
  it('draws the title as a link, the color bar, fields and the footer with its time', () => {
    const { container } = render(<RichEmbedCard embed={{
      title: 'Deploy concluído', url: 'https://ci.example.com/1', color: 0x57f287, description: 'tudo **ok**',
      fields: [{ name: 'Versão', value: '1.4.2', inline: true }, { name: 'Notas', value: 'longo', inline: false }],
      footer: 'CI', timestamp: '2026-10-28T15:00:00.000Z',
    }} />);
    const card = container.querySelector('[data-rich-embed]') as HTMLElement;
    expect(card.style.borderLeftColor).toBe('rgb(87, 242, 135)');
    expect(screen.getByRole('link', { name: 'Deploy concluído' })).toHaveAttribute('href', 'https://ci.example.com/1');
    expect(screen.getByText('ok').tagName).toBe('STRONG');
    expect(screen.getByText('Versão')).toBeInTheDocument();
    expect(screen.getByText('1.4.2')).toBeInTheDocument();
    expect(screen.getByText(/^CI • /)).toBeInTheDocument();
  });

  it('a link in the body stays a link, with no preview card of its own', () => {
    const { container } = render(<RichEmbedCard embed={{ description: 'veja https://example.com' }} />);
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-rich-embed] a')).toHaveLength(1);
  });

  it('with no url the title is plain text, and no color leaves the default bar', () => {
    const { container } = render(<RichEmbedCard embed={{ title: 'Só título' }} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect((container.querySelector('[data-rich-embed]') as HTMLElement).style.borderLeftColor).toBe('');
  });
});
