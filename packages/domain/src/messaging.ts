import { participationRules, type AgeBand } from './age';
import { tzOffsetMinutes } from './schedule';

export interface Participant { personId: string; band: AgeBand; isAgent?: false }

/**
 * Private adult-to-minor DMs are never allowed. Minors message adults inside
 * team conversations where guardians and staff are present.
 */
export function canStartDirectMessage(a: Participant, b: Participant): { ok: true } | { ok: false; reason: string } {
  if (a.personId === b.personId) return { ok: false, reason: 'You cannot message yourself.' };
  const aMinor = a.band !== 'adult';
  const bMinor = b.band !== 'adult';
  if (aMinor !== bMinor) return { ok: false, reason: 'Private messages between adults and minors are not allowed. Use the team conversation.' };
  if (aMinor && bMinor) return { ok: false, reason: 'Athletes under 18 message through team conversations.' };
  return { ok: true };
}

export function canPostInGroup(band: AgeBand): boolean {
  return participationRules(band).canPostInGroupConversations;
}

export interface QuietHours { start: string; end: string; timeZone: string }

/** True when `at` falls in quiet hours (window may cross midnight). */
export function inQuietHours(atIso: string, q: QuietHours | null): boolean {
  if (!q) return false;
  const at = new Date(atIso);
  const local = new Date(at.getTime() + tzOffsetMinutes(at, q.timeZone) * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const s = toMin(q.start);
  const e = toMin(q.end);
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export type Channel = 'in_app' | 'push' | 'email' | 'sms';
export interface DeliveryPref { channel: Channel; enabled: boolean }

/**
 * Decide delivery channels for one recipient. In-app is always recorded.
 * Quiet hours defer push/sms unless this is a named emergency alert sent
 * through the authorized emergency flow.
 */
export function planDelivery(
  prefs: DeliveryPref[],
  opts: { atIso: string; quiet: QuietHours | null; emergency: boolean; unsubscribed: Channel[] },
): { channel: Channel; status: 'queued' | 'deferred_quiet_hours' | 'suppressed' }[] {
  const out: { channel: Channel; status: 'queued' | 'deferred_quiet_hours' | 'suppressed' }[] = [{ channel: 'in_app', status: 'queued' }];
  const quiet = inQuietHours(opts.atIso, opts.quiet);
  for (const p of prefs) {
    if (p.channel === 'in_app' || !p.enabled) continue;
    if (opts.unsubscribed.includes(p.channel)) { out.push({ channel: p.channel, status: 'suppressed' }); continue; }
    if (quiet && !opts.emergency && (p.channel === 'push' || p.channel === 'sms')) { out.push({ channel: p.channel, status: 'deferred_quiet_hours' }); continue; }
    out.push({ channel: p.channel, status: 'queued' });
  }
  return out;
}

/** Aggregate reporting is suppressed below this many responses (from the brief). */
export const SURVEY_MIN_RESPONSES = 5;

export function surveyReportable(responseCount: number): boolean {
  return responseCount >= SURVEY_MIN_RESPONSES;
}
