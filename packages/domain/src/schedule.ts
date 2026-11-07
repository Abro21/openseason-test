/**
 * Recurring events in a team's own time zone. A 6:00 PM Tuesday practice stays
 * 6:00 PM local across daylight-saving changes, so occurrences are generated in
 * wall-clock time and converted to UTC per occurrence.
 */
export interface WeeklyRule {
  /** 0 = Sunday ... 6 = Saturday */
  weekdays: number[];
  /** HH:MM local wall-clock time */
  startTime: string;
  durationMinutes: number;
  /** YYYY-MM-DD inclusive, local dates */
  fromDate: string;
  untilDate: string;
  timeZone: string;
  /** local dates to skip */
  exceptDates?: string[];
}

export interface Occurrence { startsAt: string; endsAt: string; localDate: string }

const MAX_OCCURRENCES = 200;

export function expandWeekly(rule: WeeklyRule): Occurrence[] {
  if (!/^\d{2}:\d{2}$/.test(rule.startTime)) throw new Error('startTime must be HH:MM');
  if (rule.durationMinutes <= 0 || rule.durationMinutes > 24 * 60) throw new Error('duration out of range');
  if (rule.weekdays.some((d) => d < 0 || d > 6)) throw new Error('weekday out of range');
  const out: Occurrence[] = [];
  const [hh, mm] = rule.startTime.split(':').map(Number) as [number, number];
  let day = parseDate(rule.fromDate);
  const until = parseDate(rule.untilDate);
  const except = new Set(rule.exceptDates ?? []);
  while (day.getTime() <= until.getTime()) {
    const local = fmtDate(day);
    if (rule.weekdays.includes(day.getUTCDay()) && !except.has(local)) {
      const start = zonedToUtc(local, hh, mm, rule.timeZone);
      out.push({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + rule.durationMinutes * 60000).toISOString(), localDate: local });
      if (out.length > MAX_OCCURRENCES) throw new Error(`a series may not exceed ${MAX_OCCURRENCES} events`);
    }
    day = new Date(day.getTime() + 86400000);
  }
  return out;
}

function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`bad date ${s}`);
  return new Date(`${s}T00:00:00Z`);
}
function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }

/** Offset (minutes east of UTC) of a time zone at an instant. */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function zonedToUtc(localDate: string, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(`${localDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  let offset = tzOffsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() - offset * 60000);
  const offset2 = tzOffsetMinutes(utc, timeZone);
  if (offset2 !== offset) { offset = offset2; utc = new Date(guess.getTime() - offset * 60000); }
  return utc;
}

export function formatLocal(iso: string, timeZone: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export type RsvpStatus = 'yes' | 'no' | 'maybe';
export interface RsvpSummary { yes: number; no: number; maybe: number; noResponse: number }

export function summarizeRsvps(rosterAthleteIds: string[], rsvps: { athleteId: string; status: RsvpStatus }[]): RsvpSummary {
  const byAthlete = new Map(rsvps.map((r) => [r.athleteId, r.status]));
  const s: RsvpSummary = { yes: 0, no: 0, maybe: 0, noResponse: 0 };
  for (const id of rosterAthleteIds) {
    const st = byAthlete.get(id);
    if (st) s[st] += 1; else s.noResponse += 1;
  }
  return s;
}

/** Parse an SMS/email Y/N reply. Anything ambiguous is not an RSVP. */
export function parseRsvpReply(text: string): RsvpStatus | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (['y', 'yes', 'yep', 'yeah', 'in'].includes(t)) return 'yes';
  if (['n', 'no', 'nope', 'out'].includes(t)) return 'no';
  if (['m', 'maybe'].includes(t)) return 'maybe';
  return null;
}
