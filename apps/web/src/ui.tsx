import { ApiError } from '@openseason/api-client';
import { statusLabel, statusTone, type ActionStatus } from '@openseason/domain';
import { toneColors, type StatusTone } from '@openseason/tokens';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function Badge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const { fg, bg } = toneColors(dark ? 'dark' : 'light', tone);
  return <span className="badge" style={{ color: fg, background: bg }}>{children}</span>;
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

export function Show<T>({ value, children, empty }: { value: Loadable<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean }) {
  if (value.state === 'loading') return <p className="muted" role="status">Loading…</p>;
  if (value.state === 'error') return <Notice tone="danger">{describeError(value.error)}</Notice>;
  if (empty?.(value.data)) return <p className="muted">Nothing here yet.</p>;
  return <>{children(value.data)}</>;
}

/** A button that runs an async action once per press, shows progress, and reports failure next to itself. */
export function ActionButton({ onRun, children, variant, disabled, label }: {
  onRun: () => Promise<unknown>; children: ReactNode; variant?: 'primary' | 'danger' | 'quiet'; disabled?: boolean; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className={`btn ${variant ?? ''}`} disabled={busy || disabled} aria-busy={busy} aria-label={label}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try { await onRun(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
        }}>
        {busy ? 'Working…' : children}
      </button>
      {error && <span role="alert" className="small" style={{ color: 'var(--os-danger)', marginLeft: 8 }}>{error}</span>}
    </span>
  );
}

export function money(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export function when(iso: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
