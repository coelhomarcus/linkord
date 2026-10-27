import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppModal, useAppModalClose } from '@/shared/ui/app-modal';
import { PageHeader } from '@/shared/PageHeader';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';

function Probe() {
  return <p>{useAppModalClose() ? 'inside a modal' : 'outside a modal'}</p>;
}

describe('AppModal', () => {
  it('is a labelled dialog around its children', () => {
    render(<AppModal label="Ajustes" onClose={vi.fn()}><p>conteúdo</p></AppModal>);
    expect(screen.getByRole('dialog', { name: 'Ajustes' })).toHaveTextContent('conteúdo');
  });

  it('asks its owner to close on Escape', async () => {
    const onClose = vi.fn();
    render(<AppModal label="Ajustes" onClose={onClose}><p>conteúdo</p></AppModal>);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells what it renders that it is inside a modal', () => {
    render(<><Probe /><AppModal label="Ajustes" onClose={vi.fn()}><Probe /></AppModal></>);
    expect(screen.getAllByText('inside a modal')).toHaveLength(1);
    expect(screen.getAllByText('outside a modal')).toHaveLength(1);
  });
});

describe('PageHeader in a modal', () => {
  const header = <PageHeader title="Ajustes" />;

  it('closes the modal from its own button, in place of the conversation-list button', async () => {
    window.matchMedia = ((query: string) => ({
      matches: /max-width/.test(query), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const onClose = vi.fn();
    render(<SidebarProvider><AppModal label="Ajustes" onClose={onClose}>{header}</AppModal></SidebarProvider>);
    expect(screen.queryByRole('button', { name: 'Abrir lista de conversas' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no close button on a page in the content area', () => {
    render(<SidebarProvider>{header}</SidebarProvider>);
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });
});
