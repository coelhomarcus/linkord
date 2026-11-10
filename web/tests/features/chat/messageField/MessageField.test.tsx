import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MessageField } from '@/features/chat/messageField/MessageField';
import { fieldValue, pressShiftEnter, typeInField } from '@tests/fixtures/messageFieldFixture';

const party = { id: 'a'.repeat(32), name: 'party', animated: false };
const resolve = (name: string) => (name === 'party' ? party : null);

function Field({ initial = '', onChange = () => {}, onKeyDown }: { initial?: string; onChange?: (value: string, caret: number, typed: string | null) => void; onKeyDown?: (event: KeyboardEvent) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <MessageField
      value={value}
      aria-label="Mensagem"
      placeholder="Conversar"
      resolveCustomEmoji={resolve}
      onKeyDown={onKeyDown}
      onChange={(v, c, t) => { setValue(v); onChange(v, c, t); }}
    />
  );
}

const field = () => screen.getByRole('textbox', { name: 'Mensagem' });

describe('MessageField', () => {
  it('reports each change with the caret and what was typed', async () => {
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    await typeInField(field(), 'oi');
    expect(fieldValue(field())).toBe('oi');
    expect(onChange).toHaveBeenLastCalledWith('oi', 2, 'i');
  });

  it('draws a server emoji and a Unicode emoji, keeping the text as typed', async () => {
    render(<Field initial="olá :party: 🎉" />);
    expect(await screen.findByRole('img', { name: ':party:' })).toBeInTheDocument();
    expect(screen.getByText('🎉')).toHaveAttribute('data-emoji');
    expect(fieldValue(field())).toBe('olá :party: 🎉');
  });

  it('turns a :name: into its picture as its closing colon is typed, and leaves unknown names and code alone', async () => {
    render(<Field />);
    await typeInField(field(), 'a :party: b :nada: `:party:`');
    expect(screen.getAllByRole('img', { name: ':party:' })).toHaveLength(1);
    expect(fieldValue(field())).toBe('a :party: b :nada: `:party:`');
  });

  it('lets the owner take a key before the editor, and makes a line break of Shift+Enter', async () => {
    const onKeyDown = vi.fn((event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey) event.preventDefault(); });
    render(<Field onKeyDown={onKeyDown} />);
    await typeInField(field(), 'a{Enter}');
    expect(fieldValue(field())).toBe('a');
    await pressShiftEnter(field());
    await typeInField(field(), 'b');
    expect(fieldValue(field())).toBe('a\nb');
  });

  it('exposes the placeholder like a textarea', () => {
    render(<Field />);
    expect(screen.getByPlaceholderText('Conversar')).toBe(field());
  });
});
