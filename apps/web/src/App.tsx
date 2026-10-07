import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { AppLayout } from './components/AppLayout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SessionsPage } from './pages/SessionsPage';
import { IssueReportPage } from './pages/IssueReportPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { ArticlesPage } from './pages/ArticlesPage';
import { ArticleEditorPage } from './pages/ArticleEditorPage';
import { EscalationsPage } from './pages/EscalationsPage';
import { LogsPage } from './pages/LogsPage';
import { AiSettingsPage } from './pages/AiSettingsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <AppLayout />;
}

function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(feature)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoutes />}>
          <Route
            index
            element={
              <FeatureGate feature="dashboard">
                <DashboardPage />
              </FeatureGate>
            }
          />
          <Route
            path="sessions"
            element={
              <FeatureGate feature="sessions">
                <SessionsPage />
              </FeatureGate>
            }
          />
          <Route
            path="sessions/:id"
            element={
              <FeatureGate feature="sessions">
                <SessionDetailPage />
              </FeatureGate>
            }
          />
          <Route
            path="escalations"
            element={
              <FeatureGate feature="escalations">
                <EscalationsPage />
              </FeatureGate>
            }
          />
          <Route
            path="issue-categories"
            element={
              <FeatureGate feature="issue-categories">
                <IssueReportPage />
              </FeatureGate>
            }
          />
          <Route
            path="articles"
            element={
              <FeatureGate feature="articles">
                <ArticlesPage />
              </FeatureGate>
            }
          />
          <Route
            path="articles/new"
            element={
              <FeatureGate feature="articles.manage">
                <ArticleEditorPage />
              </FeatureGate>
            }
          />
          <Route
            path="articles/:id"
            element={
              <FeatureGate feature="articles.manage">
                <ArticleEditorPage />
              </FeatureGate>
            }
          />
          <Route
            path="ai"
            element={
              <FeatureGate feature="ai">
                <AiSettingsPage />
              </FeatureGate>
            }
          />
          <Route
            path="logs"
            element={
              <FeatureGate feature="logs">
                <LogsPage />
              </FeatureGate>
            }
          />
          <Route
            path="settings"
            element={
              <FeatureGate feature="settings">
                <SettingsPage />
              </FeatureGate>
            }
          />
          <Route
            path="users"
            element={
              <FeatureGate feature="users">
                <UsersPage />
              </FeatureGate>
            }
          />
          <Route
            path="roles"
            element={
              <FeatureGate feature="roles">
                <RolesPage />
              </FeatureGate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
