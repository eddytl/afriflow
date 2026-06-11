import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { AppLayout } from './components/layout/AppLayout';
import { Toaster } from './components/ui/toaster';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { TwoFactorPage } from './pages/auth/TwoFactorPage';
import { DashboardPage } from './pages/DashboardPage';
import { ContactsPage } from './pages/ContactsPage';
import { FunnelsPage } from './pages/FunnelsPage';
import { EmailsPage } from './pages/emails/EmailsPage';
import { SmsPage } from './pages/SmsPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { PipelinePage } from './pages/crm/PipelinePage';
import { CalendarPage } from './pages/crm/CalendarPage';
import { CalendarEventFormPage } from './pages/crm/CalendarEventFormPage';
import { TagsPage } from './pages/crm/TagsPage';
import { SalesPage } from './pages/sales/SalesPage';
import { WebsitesPage } from './pages/sites/WebsitesPage';
import { CreatorPagesPage } from './pages/sites/CreatorPagesPage';
import { BlogsPage } from './pages/sites/BlogsPage';
import { WorkflowsPage } from './pages/automations/WorkflowsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AiPage } from './pages/AiPage';
import { SettingsPage } from './pages/settings/SettingsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/2fa" element={<TwoFactorPage />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/funnels" element={<FunnelsPage />} />

          <Route path="/sites" element={<Navigate to="/sites/websites" replace />} />
          <Route path="/sites/websites" element={<WebsitesPage />} />
          <Route path="/sites/creator-pages" element={<CreatorPagesPage />} />
          <Route path="/sites/blogs" element={<BlogsPage />} />

          <Route path="/emails" element={<Navigate to="/emails/campaigns" replace />} />
          <Route path="/emails/campaigns" element={<EmailsPage />} />
          <Route path="/emails/newsletters" element={<EmailsPage />} />
          <Route path="/emails/statistics" element={<EmailsPage />} />

          <Route path="/sms" element={<Navigate to="/sms/templates" replace />} />
          <Route path="/sms/templates" element={<SmsPage tab="templates" />} />
          <Route path="/sms/statistics" element={<SmsPage tab="statistics" />} />
          <Route path="/automations" element={<Navigate to="/automations/rules" replace />} />
          <Route path="/automations/rules" element={<AutomationsPage />} />
          <Route path="/automations/workflows" element={<WorkflowsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />

          <Route path="/crm" element={<Navigate to="/crm/pipeline" replace />} />
          <Route path="/crm/tags" element={<TagsPage />} />
          <Route path="/crm/pipeline" element={<PipelinePage />} />
          <Route path="/crm/calendar" element={<CalendarPage />} />
          <Route path="/crm/calendar/new" element={<CalendarEventFormPage />} />
          <Route path="/crm/calendar/:id/edit" element={<CalendarEventFormPage />} />

          <Route path="/sales" element={<Navigate to="/sales/products" replace />} />
          <Route path="/sales/products" element={<SalesPage tab="products" />} />
          <Route path="/sales/orders" element={<SalesPage tab="orders" />} />
          <Route path="/sales/subscriptions" element={<SalesPage tab="subscriptions" />} />
          <Route path="/sales/coupons" element={<SalesPage tab="coupons" />} />

          <Route path="/ai" element={<AiPage />} />

          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
    </BrowserRouter>
  );
}
