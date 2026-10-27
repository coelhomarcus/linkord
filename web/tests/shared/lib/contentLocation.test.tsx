import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Location } from 'react-router';
import { ContentLocationProvider, useContentLocation } from '@/shared/lib/contentLocation';

function Path() {
  return <p>{useContentLocation().pathname}</p>;
}

const behind: Location = { pathname: '/app/friends', search: '', hash: '', state: null, key: 'k' };

describe('useContentLocation', () => {
  it('is the URL when no modal is holding the page behind it', () => {
    render(<MemoryRouter initialEntries={['/app/conversations']}><Path /></MemoryRouter>);
    expect(screen.getByText('/app/conversations')).toBeInTheDocument();
  });

  it('is the page behind the modal while one is open', () => {
    render(
      <MemoryRouter initialEntries={['/app/settings/av']}>
        <ContentLocationProvider value={behind}><Path /></ContentLocationProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('/app/friends')).toBeInTheDocument();
  });
});
