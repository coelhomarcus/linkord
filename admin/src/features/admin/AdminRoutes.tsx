import type { ComponentProps } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuditPage } from './AuditPage';
import { BackupPage } from './BackupPage';
import { CallMetricsPage } from './CallMetricsPage';
import { ADMIN_PATH } from './adminCatalog';
import { AdminLayout } from './AdminLayout';
import { DashboardPage } from './DashboardPage';
import { ServerDetailPage } from './ServerDetailPage';
import { ServersPage } from './ServersPage';
import { WebhooksPage } from './WebhooksPage';
import { WebhookDetailPage } from './WebhookDetailPage';
import { ReportDetailPage } from './ReportDetailPage';
import { ReportsPage } from './ReportsPage';
import { SystemPage } from './SystemPage';
import { UserDetailPage } from './UserDetailPage';
import { UsersPage } from './UsersPage';
export function AdminRoutes(layout: ComponentProps<typeof AdminLayout>) {
  return (
    <Routes>
      <Route element={<AdminLayout {...layout} />}>
        <Route index element={<DashboardPage />} />
        <Route path="call-metrics" element={<CallMetricsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage viewerId={layout.viewer.id} />} />
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
        <Route path="backup" element={<BackupPage />} />
        <Route path="*" element={<Navigate to={ADMIN_PATH} replace />} />
      </Route>
    </Routes>
  );
}
