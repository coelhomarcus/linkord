import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/primitives/dialog';

function Stack() {
  const [inner, setInner] = useState(false);
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Fora</DialogTitle>
        <button type="button" onClick={() => setInner(true)}>abrir</button>
        <Dialog open={inner} onOpenChange={setInner}>
          <DialogContent><DialogTitle>Dentro</DialogTitle></DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

describe('dialogs opened over dialogs', () => {
  it('darken the one underneath, since a nested dialog has no backdrop of its own', async () => {
    render(<Stack />);
    const outer = screen.getByRole('dialog', { name: 'Fora' });
    expect(outer).not.toHaveAttribute('data-nested-dialog-open');
    await userEvent.click(screen.getByRole('button', { name: 'abrir' }));
    const inner = await screen.findByRole('dialog', { name: 'Dentro' });
    await waitFor(() => expect(outer).toHaveAttribute('data-nested-dialog-open'));
    // the whole stack shares one backdrop: the dimming of the lower dialog is what makes the hierarchy readable
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1);
    expect(outer.className).toContain('data-nested-dialog-open:brightness-');
    expect(inner).not.toHaveAttribute('data-nested-dialog-open');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(outer).not.toHaveAttribute('data-nested-dialog-open'));
  });
});
