import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sessions', label: 'Sessions', icon: MessagesSquare },
  { to: '/escalations', label: 'Escalations', icon: ShieldAlert },
  { to: '/issue-categories', label: 'Issue Categories', icon: BarChart3 },
  { to: '/articles', label: 'Knowledge Base', icon: BookOpen },
  { to: '/ai', label: 'AI Providers', icon: Bot },
  { to: '/logs', label: 'Logs', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/users', label: 'Users', icon: Users },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-[var(--color-surface)]">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface-muted)] md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-[var(--color-line)] px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">HelpDesk AI</p>
            <p className="text-[11px] text-slate-500">Troubleshooting console</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-300'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--color-line)] p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-slate-200">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
            {user?.role === 'admin' ? (
              <span className="mt-1 inline-block rounded bg-indigo-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                admin
              </span>
            ) : null}
          </div>
          <button
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800/70 hover:text-slate-200"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 px-4 backdrop-blur md:px-6">
          <div className="md:hidden">
            <p className="text-sm font-semibold text-slate-100">HelpDesk AI</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">Slack troubleshooting agent</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
              {user?.name?.slice(0, 1).toUpperCase() ?? '?'}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
