/**
 * Pending Action lifecycle. The database enforces these transitions
 * (supabase/migrations/*_actions.sql); this module mirrors them so clients
 * show the same truth and tests can check parity.
 *
 *   proposed <-> in_review          editing loop
 *   needs_refresh -> in_review      after source changes / failed revalidation
 *   in_review -> approved -> queued -> processing -> succeeded | failed | uncertain
 *   proposed/in_review/needs_refresh -> rejected -> (retry creates a new revision) | ended
 */
export const ACTION_KINDS = ['send_message', 'schedule_change', 'refund', 'share_player_feedback'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_STATUSES = [
  'proposed', 'in_review', 'needs_refresh', 'approved', 'rejected', 'ended',
  'queued', 'processing', 'succeeded', 'failed', 'uncertain',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

const TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['in_review', 'needs_refresh', 'rejected'],
  in_review: ['proposed', 'in_review', 'needs_refresh', 'approved', 'rejected'],
  needs_refresh: ['in_review', 'rejected'],
  approved: ['queued', 'needs_refresh'],
  rejected: ['proposed', 'ended'],
  ended: [],
  queued: ['processing', 'failed', 'needs_refresh'],
  processing: ['succeeded', 'failed', 'uncertain'],
  succeeded: [],
  failed: [],
  uncertain: ['succeeded', 'failed'],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(s: ActionStatus): boolean {
  return TRANSITIONS[s].length === 0;
}

export function isEditable(s: ActionStatus): boolean {
  return s === 'proposed' || s === 'in_review' || s === 'needs_refresh';
}

export function statusLabel(s: ActionStatus): string {
  return {
    proposed: 'Proposed', in_review: 'In review', needs_refresh: 'Needs refresh', approved: 'Approved',
    rejected: 'Rejected', ended: 'Ended', queued: 'Queued', processing: 'Sending',
    succeeded: 'Done', failed: 'Failed', uncertain: 'Outcome uncertain',
  }[s];
}

export function statusTone(s: ActionStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'pending' {
  if (s === 'succeeded') return 'success';
  if (s === 'failed' || s === 'rejected') return 'danger';
  if (s === 'needs_refresh' || s === 'uncertain') return 'warning';
  if (s === 'queued' || s === 'processing' || s === 'approved') return 'info';
  if (s === 'ended') return 'neutral';
  return 'pending';
}

/** Deterministic JSON so the same payload always hashes the same way. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Material fields: changing any of these invalidates a prior approval. */
export const MATERIAL_FIELDS: Record<ActionKind, readonly string[]> = {
  send_message: ['recipients', 'body', 'title', 'conversation_id', 'team_id'],
  schedule_change: ['event_id', 'starts_at', 'ends_at', 'location', 'notify'],
  refund: ['payment_id', 'amount_cents', 'currency'],
  share_player_feedback: ['athlete_id', 'body', 'recipients'],
};

export function materiallyChanged(kind: ActionKind, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return MATERIAL_FIELDS[kind].some((f) => canonicalJson(a[f]) !== canonicalJson(b[f]));
}
