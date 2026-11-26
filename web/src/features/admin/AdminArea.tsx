import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/state/AuthContext';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { AdminRoutes } from './AdminRoutes';

/** Shown when the server stopped treating this account as an administrator.
 * The pages are gone by then (their data, dialogs and pending reads with them);
 * leaving also fixes the stale role so the guard and the rail agree. */
function AccessLost() {
  const { t } = useTranslation('admin');
  const { dispatch } = useRoom('dispatch');
  const navigate = useNavigate();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <h2 className="text-title font-semibold text-text-primary">{t('layout.accessLostTitle')}</h2>
      <p className="max-w-md text-label text-text-muted">{t('layout.accessLostDescription')}</p>
      <Button type="button" onClick={() => { dispatch({ type: 'SET_ROLE', role: 'user' }); navigate(ROUTES.home, { replace: true }); }}>
        {t('layout.backToConversations')}
      </Button>
    </div>
  );
}

/** Shown when the server says there is no session: the area is gone, and the
 * auth state is re-read so the app can take the person to the login. */
function SessionEnded() {
  const { t } = useTranslation('admin');
  const { refresh } = useAuth();
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-12 text-center">
      <h2 className="text-title font-semibold text-text-primary">{t('layout.sessionEndedTitle')}</h2>
      <p className="max-w-md text-label text-text-muted">{t('layout.sessionEndedDescription')}</p>
    </div>
  );
}

function renderUnavailable(reason: 'access' | 'session') {
  return reason === 'access' ? <AccessLost /> : <SessionEnded />;
}

/** Integrated administration for installations with no separate admin origin. */
export default function AdminArea() {
  const state = useRoomState('me');
  if (state.me.role !== 'admin') return <Navigate to={ROUTES.home} replace />;
  return <AdminRoutes renderUnavailable={renderUnavailable} />;
}
