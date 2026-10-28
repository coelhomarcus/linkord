import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { colorFor } from '@/shared/Avatar';

describe('GroupAvatar', () => {
  it('with no picture, is a solid color with white initials, the same color every time for a group', () => {
    const { container, rerender } = render(<GroupAvatar id="g1" title="os xerecas" size={44} />);
    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar).toHaveTextContent('OX');
    expect(avatar).toHaveClass('text-white');
    expect(avatar).not.toHaveClass('border');
    const color = avatar.style.background;
    expect(color).toBeTruthy();
    // renamed, it keeps its color: it comes from the id
    rerender(<GroupAvatar id="g1" title="outro nome" size={44} />);
    expect((container.firstElementChild as HTMLElement).style.background).toBe(color);
  });

  it('different groups tend to differ in color', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => colorFor(id)));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('with a picture, shows it in a quiet ring and no solid color', () => {
    const { container } = render(<GroupAvatar id="g1" title="os xerecas" avatar="/uploads/x" size={44} />);
    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar.querySelector('img')).toHaveAttribute('src', '/uploads/x');
    expect(avatar).toHaveClass('border');
    expect(avatar.style.background).toBe('');
  });
});
