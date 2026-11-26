import { Navigate, Route, Routes } from 'react-router';
import { AuditPage } from './AuditPage';
import { ADMIN_USERS_PATH } from './adminCatalog';
import { AdminLayout } from './AdminLayout';
import { AdminIndex } from './AdminNavigation';
import { ServerDetailPage } from './ServerDetailPage';
import { ServersPage } from './ServersPage';
import { WebhooksPage } from './WebhooksPage';
import { WebhookDetailPage } from './WebhookDetailPage';
import { ReportDetailPage } from './ReportDetailPage';
import { ReportsPage } from './ReportsPage';
import { SystemPage } from './SystemPage';
import { UserDetailPage } from './UserDetailPage';
import { UsersPage } from './UsersPage';
import { useAdminMeasured, useAdminMode } from './useAdminMode';

/** Bare /admin: the section index when there is no sidebar to pick from,
 * Users otherwise. Only this entry depends on the mode — a detail URL is
 * never redirected because of the window size. */
function AdminEntry() {
  const mode = useAdminMode();
  // before the first measurement `mode` is a guess: deciding on it would redirect a narrow screen
  if (!useAdminMeasured()) return null;
  return mode === 'compact' ? <AdminIndex /> : <Navigate to={ADMIN_USERS_PATH} replace />;
}

export function AdminRoutes({ viewerId }: { viewerId: string }) {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminEntry />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage viewerId={viewerId} />} />
        <Route path="servers" element={<ServersPage />} />
        <Route path="servers/:id" element={<ServerDetailPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="webhooks/:id" element={<WebhookDetailPage />} />
        {/* groups became servers and bots channel webhooks; their ids did not carry over */}
        <Route path="groups/*" element={<Navigate to="/admin/servers" replace />} />
        <Route path="bots/*" element={<Navigate to="/admin/webhooks" replace />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<Navigate to={ADMIN_USERS_PATH} replace />} />
      </Route>
    </Routes>
  );
}
