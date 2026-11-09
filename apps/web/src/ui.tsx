import { ApiError } from '@openseason/api-client';
import { statusLabel, statusTone, type ActionStatus } from '@openseason/domain';
import type { StatusTone } from '@openseason/tokens';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Status chip. Colours come from the token CSS variables, so it follows light and dark mode. */
export function Badge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

/** Title row for a page: one heading, an optional one-line explanation and the page's main action. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <p className="empty-title">{title}</p>
      {children && <p className="muted small">{children}</p>}
    </div>
  );
}

/** Calendar-style date block used at the start of every event row. */
export function DateTile({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="date-tile" aria-hidden="true">
      <span className="date-dow">{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)}</span>
      <span className="date-day">{d.getDate()}</span>
      <span className="date-mon">{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d)}</span>
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function ActionBadge({ status }: { status: string }) {
  const s = status as ActionStatus;
  return <Badge tone={statusTone(s)}>{statusLabel(s) ?? status}</Badge>;
}

export function Notice({ tone, children }: { tone: 'danger' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>;
}

/** Plain-language message for an error, never a stack trace. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case 'unauthenticated': return 'Your session ended. Please sign in again.';
      case 'forbidden': return `You don't have access to this. (${e.message})`;
      case 'conflict': return `This changed since you opened it. Refresh to see the latest. (${e.message})`;
      case 'rate_limited': return `Too many attempts. Try again later. (${e.message})`;
      case 'network': return 'Could not reach the server. Check your connection and try again.';
      default: return e.message;
    }
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export type Loadable<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T };

/** Loads data and exposes reload(); ignores results that arrive after a newer request. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [Loadable<T>, () => void] {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' });
  const seq = useRef(0);
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    run().then(
      (data) => mine === seq.current && setValue({ state: 'ready', data }),
      (error) => mine === seq.current && setValue({ state: 'error', error }),
    );
  }, [run]);
  useEffect(() => {
    setValue({ state: 'loading' });
    reload();
  }, [reload]);
  return [value, reload];
}

export function Show<T>({ value, children, empty, emptyView }: { value: Loadable<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean; emptyView?: ReactNode }) {
  if (value.state === 'loading') return <p className="loading muted" role="status">Loading…</p>;
  if (value.state === 'error') return <Notice tone="danger">{describeError(value.error)}</Notice>;
  if (empty?.(value.data)) return emptyView ?? <Empty title="Nothing here yet." />;
  return <>{children(value.data)}</>;
}

/** A button that runs an async action once per press, shows progress, and reports failure next to itself. */
export function ActionButton({ onRun, children, variant, disabled, label, pressed, className }: {
  onRun: () => Promise<unknown>; children: ReactNode; variant?: 'primary' | 'danger' | 'quiet'; disabled?: boolean; label?: string;
  pressed?: boolean; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="action">
      <button type="button" className={className ?? `btn ${variant ?? ''}`} disabled={busy || disabled} aria-busy={busy} aria-label={label}
        aria-pressed={pressed}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try { await onRun(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
        }}>
        {busy ? 'Working…' : children}
      </button>
      {error && <span role="alert" className="action-error small">{error}</span>}
    </span>
  );
}

export function money(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export function when(iso: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function time(iso: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function shortDate(isoDate: string) {
  // Plain YYYY-MM-DD dates are calendar days, not instants: format them without a time zone shift.
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(y!, (m ?? 1) - 1, d ?? 1));
}
