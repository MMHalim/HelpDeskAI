import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ResolutionStatus, SessionStatus } from '@helpdesk/shared';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '—';
  const diff = Date.now() - date;
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat().format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(
    value,
  );
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 1000) / 10}%`;
}

const SESSION_STATUS_STYLES: Record<SessionStatus, string> = {
  in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  assigned: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  waiting_on_user: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  escalated: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  closed: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  abandoned: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function sessionStatusClass(status: SessionStatus): string {
  return SESSION_STATUS_STYLES[status] ?? SESSION_STATUS_STYLES.closed;
}

const RESOLUTION_STYLES: Record<ResolutionStatus, string> = {
  in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  escalated: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  abandoned: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function resolutionStatusClass(status: ResolutionStatus): string {
  return RESOLUTION_STYLES[status] ?? RESOLUTION_STYLES.in_progress;
}

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
