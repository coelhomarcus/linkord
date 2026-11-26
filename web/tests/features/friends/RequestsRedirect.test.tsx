import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/requests" element={<RequestsRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequestsRedirect (links antigos)', () => {
  it('/requests vai para as solicitacoes recebidas', () => {
    at('/requests');
    expect(screen.getByTestId('where')).toHaveTextContent('/friends?tab=pending#received');
  });

  it('/requests?tab=invitations vai para os convites', () => {
    at('/requests?tab=invitations');
    expect(screen.getByTestId('where')).toHaveTextContent('/friends?tab=pending#invitations');
  });

  it('com barra final e tab desconhecida ainda cai nas recebidas', () => {
    at('/requests/?tab=outra');
    expect(screen.getByTestId('where')).toHaveTextContent('/friends?tab=pending#received');
  });
});
