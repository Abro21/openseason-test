import { describe, expect, it } from 'vitest';
import {
  ageBand, canStartDirectMessage, canTransition, canUseStaff, canonicalJson, checkoutBreakdown, consentSatisfies,
  displayTitle, expandWeekly, inQuietHours, materiallyChanged, orgCan, parseRsvpReply, planDelivery, roleForWork,
  splitInstallments, STAFF_ROLE_IDS, summarizeRsvps, surveyReportable, teamCan,
} from './index';

describe('staff roles', () => {
  it('has exactly the four canonical roles with stable ids', () => {
    expect(STAFF_ROLE_IDS).toEqual(['player_development', 'practice_prep', 'dobo', 'admin']);
  });
  it('renames without changing identity and falls back on blank titles', () => {
    expect(displayTitle('admin', { admin: 'Pat' })).toBe('Pat');
    expect(displayTitle('admin', { admin: '   ' })).toBe('Admin');
  });
  it('maps work kinds to a single owner role', () => {
    expect(roleForWork('practice_plan')).toBe('practice_prep');
    expect(roleForWork('fee_reminder')).toBe('admin');
  });
});

describe('age bands and consent', () => {
  it('computes bands on birthdays correctly', () => {
    expect(ageBand('2013-11-08', '2026-11-07')).toBe('under_13');
    expect(ageBand('2013-11-07', '2026-11-07')).toBe('teen');
    expect(ageBand('2008-11-07', '2026-11-07')).toBe('adult');
    expect(ageBand(null, '2026-11-07')).toBe('under_13');
  });
  it('never accepts a checkbox as under-13 consent', () => {
    expect(consentSatisfies('under_13', 'verified', 'checkbox', true)).toBe(false);
    expect(consentSatisfies('under_13', 'verified', 'provider_verified', true)).toBe(true);
    expect(consentSatisfies('under_13', 'verified', 'provider_verified', false)).toBe(false);
    expect(consentSatisfies('teen', 'none', null, false)).toBe(false);
    expect(consentSatisfies('adult', 'none', null, false)).toBe(true);
  });
});

describe('pending actions', () => {
  it('allows the editing loop and blocks dispatch of rejected work', () => {
    expect(canTransition('proposed', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'proposed')).toBe(true);
    expect(canTransition('needs_refresh', 'in_review')).toBe(true);
    expect(canTransition('rejected', 'queued')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('succeeded', 'queued')).toBe(false);
    expect(canTransition('uncertain', 'succeeded')).toBe(true);
  });
  it('hashes payloads canonically', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  it('treats recipient and body changes as material', () => {
    const a = { recipients: ['x'], body: 'hi', note: 1 };
    expect(materiallyChanged('send_message', a, { ...a, note: 2 })).toBe(false);
    expect(materiallyChanged('send_message', a, { ...a, recipients: ['x', 'y'] })).toBe(true);
  });
});

describe('schedule', () => {
  it('keeps local wall-clock time across a DST change', () => {
    const occ = expandWeekly({ weekdays: [2], startTime: '18:00', durationMinutes: 90, fromDate: '2026-10-27', untilDate: '2026-11-10', timeZone: 'America/Denver' });
    expect(occ.map((o) => o.startsAt)).toEqual(['2026-10-28T00:00:00.000Z', '2026-11-04T01:00:00.000Z', '2026-11-11T01:00:00.000Z']);
    expect(occ[0]!.localDate).toBe('2026-10-27');
  });
  it('honours exception dates and caps series size', () => {
    const occ = expandWeekly({ weekdays: [1, 3], startTime: '17:00', durationMinutes: 60, fromDate: '2026-11-02', untilDate: '2026-11-08', timeZone: 'America/Denver', exceptDates: ['2026-11-04'] });
    expect(occ).toHaveLength(1);
    expect(() => expandWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '17:00', durationMinutes: 60, fromDate: '2026-01-01', untilDate: '2026-12-31', timeZone: 'UTC' })).toThrow();
  });
  it('summarizes RSVPs including non-responders and parses Y/N replies', () => {
    expect(summarizeRsvps(['a', 'b', 'c'], [{ athleteId: 'a', status: 'yes' }, { athleteId: 'z', status: 'no' }])).toEqual({ yes: 1, no: 0, maybe: 0, noResponse: 2 });
    expect(parseRsvpReply(' Yes! ')).toBe('yes');
    expect(parseRsvpReply('N')).toBe('no');
    expect(parseRsvpReply('yes but late')).toBeNull();
  });
});

describe('money', () => {
  it('splits installments without losing cents', () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b)).toBe(10000);
    expect(() => splitInstallments(-1, 2)).toThrow();
  });
  it('does not invent a processing fee when unconfigured', () => {
    expect(checkoutBreakdown(5000, { mode: 'unconfigured' })).toMatchObject({ feeCents: 0, totalCents: 5000 });
    expect(checkoutBreakdown(10000, { mode: 'payer_pays', percentBps: 290, fixedCents: 30 }).totalCents).toBe(10320);
  });
  it('only active (or in-period past_due) staff plans unlock staff', () => {
    const now = '2026-11-07T00:00:00Z';
    expect(canUseStaff(null, now)).toBe(false);
    expect(canUseStaff({ plan: 'diy', status: 'active', currentPeriodEnd: null }, now)).toBe(false);
    expect(canUseStaff({ plan: 'staff', status: 'active', currentPeriodEnd: null }, now)).toBe(true);
    expect(canUseStaff({ plan: 'staff', status: 'past_due', currentPeriodEnd: '2026-11-01T00:00:00Z' }, now)).toBe(false);
    expect(canUseStaff({ plan: 'staff', status: 'canceled', currentPeriodEnd: '2027-01-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('messaging', () => {
  it('blocks private adult-minor DMs', () => {
    expect(canStartDirectMessage({ personId: 'a', band: 'adult' }, { personId: 'b', band: 'teen' }).ok).toBe(false);
    expect(canStartDirectMessage({ personId: 'a', band: 'adult' }, { personId: 'b', band: 'adult' }).ok).toBe(true);
  });
  it('handles quiet hours across midnight in local time', () => {
    const q = { start: '21:00', end: '07:00', timeZone: 'America/Denver' };
    expect(inQuietHours('2026-11-08T05:00:00Z', q)).toBe(true); // 22:00 MST
    expect(inQuietHours('2026-11-08T18:00:00Z', q)).toBe(false); // 11:00 MST
  });
  it('defers push in quiet hours except authorized emergencies, and honours unsubscribe', () => {
    const prefs = [{ channel: 'push' as const, enabled: true }, { channel: 'sms' as const, enabled: true }, { channel: 'email' as const, enabled: true }];
    const quiet = { start: '21:00', end: '07:00', timeZone: 'America/Denver' };
    const normal = planDelivery(prefs, { atIso: '2026-11-08T05:00:00Z', quiet, emergency: false, unsubscribed: ['email'] });
    expect(normal).toEqual([
      { channel: 'in_app', status: 'queued' }, { channel: 'push', status: 'deferred_quiet_hours' },
      { channel: 'sms', status: 'deferred_quiet_hours' }, { channel: 'email', status: 'suppressed' },
    ]);
    const emergency = planDelivery(prefs, { atIso: '2026-11-08T05:00:00Z', quiet, emergency: true, unsubscribed: [] });
    expect(emergency.every((d) => d.status === 'queued')).toBe(true);
  });
  it('suppresses survey aggregates below five responses', () => {
    expect(surveyReportable(4)).toBe(false);
    expect(surveyReportable(5)).toBe(true);
  });
});

describe('permissions', () => {
  it('owner does not imply safeguarding access', () => {
    expect(orgCan(['owner'], 'manage_finance')).toBe(true);
    expect(orgCan(['owner'], 'review_safeguarding')).toBe(false);
  });
  it('assistants cannot manage roster or message the team by default', () => {
    expect(teamCan('assistant_coach', 'manage_roster')).toBe(false);
    expect(teamCan('assistant_coach', 'take_attendance')).toBe(true);
  });
});
