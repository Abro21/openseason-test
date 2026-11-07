import { afterAll, describe, expect, it } from 'vitest';
import { ATHLETES, DOCUMENTS, EVENTS, INVOICES, ORGS, PEOPLE, TEAMS, TRYOUTS } from '../src/seed-ids.js';
import { endPool, tx, type Tx } from './harness.js';

afterAll(endPool);

const week = { p_from: new Date(Date.now() - 86400e3).toISOString(), p_to: new Date(Date.now() + 40 * 86400e3).toISOString() };

async function firstInstallment(t: Tx, invoice: string) {
  await t.asAdmin();
  const [n] = await t.sql<{ id: string }>('select id from public.installments where invoice_id = $1 and seq = 1', [invoice]);
  return n!.id;
}

describe('schedule and RSVP', () => {
  it('lets a guardian RSVP for their own child only', () =>
    tx(async (t) => {
      await t.as('pat');
      await t.rpc('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: ATHLETES.mia, p_status: 'yes' });
      expect(await t.fails('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: ATHLETES.ava, p_status: 'no' })).toMatch(/not allowed/);
      const sched = await t.rpc('team_schedule', { p_team: TEAMS.u12Blue, ...week });
      const game = sched.find((e: any) => e.id === EVENTS.blueGame);
      expect(game.my_rsvps).toEqual([{ athlete_id: ATHLETES.mia, athlete: 'Mia', status: 'yes' }]);
      expect(game.rsvp_summary).toBeNull();
    }));

  it('lets a teen RSVP for themselves', () =>
    tx(async (t) => {
      await t.as('leo');
      await t.rpc('rsvp_set', { p_event: EVENTS.redGame, p_athlete: ATHLETES.leo, p_status: 'maybe' });
    }));

  it('shows a fan the schedule without location or RSVPs, and nothing for other teams', () =>
    tx(async (t) => {
      await t.as('gail');
      const sched = await t.rpc('team_schedule', { p_team: TEAMS.u12Blue, ...week });
      expect(sched.length).toBeGreaterThan(0);
      for (const e of sched) {
        expect(e.location).toBeNull();
        expect(e.my_rsvps).toEqual([]);
        expect(e.rsvp_summary).toBeNull();
      }
      expect(await t.fails('team_schedule', { p_team: TEAMS.u15Red, ...week })).toMatch(/not allowed/);
      expect(await t.fails('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: ATHLETES.mia, p_status: 'yes' })).toMatch(/not allowed/);
    }));

  it('gives staff an RSVP summary', () =>
    tx(async (t) => {
      await t.as('casey');
      const sched = await t.rpc('team_schedule', { p_team: TEAMS.u12Blue, ...week });
      expect(sched.find((e: any) => e.id === EVENTS.blueGame).rsvp_summary).toEqual({ yes: 1, no: 0, maybe: 0, no_response: 1 });
    }));

  it('rejects a stale edit instead of overwriting', () =>
    tx(async (t) => {
      await t.as('casey');
      const [e] = await t.sql<{ starts_at: Date; ends_at: Date; version: number }>('select starts_at, ends_at, version from public.events where id = $1', [EVENTS.blueGame]);
      const later = new Date(e!.starts_at.getTime() + 3600e3), laterEnd = new Date(e!.ends_at.getTime() + 3600e3);
      const v = await t.rpc('event_update', { p_event: EVENTS.blueGame, p_expected_version: e!.version, p_starts: later, p_ends: laterEnd, p_location: 'Field 2' });
      expect(v).toBe(e!.version + 1);
      expect(await t.fails('event_update', { p_event: EVENTS.blueGame, p_expected_version: e!.version, p_starts: later, p_ends: laterEnd, p_location: 'Field 9' })).toMatch(/changed since/);
      await t.as('alex');
      expect(await t.fails('event_update', { p_event: EVENTS.blueGame, p_expected_version: v, p_starts: later, p_ends: laterEnd, p_location: 'x' })).toMatch(/not allowed/);
    }));

  it('creates recurring practices at the same local time across the DST change', () =>
    tx(async (t) => {
      await t.as('casey');
      const n = await t.rpc('event_series_create', {
        p_team: TEAMS.u12Blue, p_kind: 'practice', p_title: 'Tuesday practice', p_weekdays: [2], p_start_time: '18:00',
        p_duration_minutes: 90, p_from: '2026-10-20', p_until: '2026-11-10', p_location: 'Field 3',
      });
      expect(n).toBe(4);
      const rows = await t.sql<{ s: string }>(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') s from public.events where title = 'Tuesday practice' order by starts_at`);
      expect(rows.map((r) => r.s)).toEqual(['2026-10-21T00:00', '2026-10-28T00:00', '2026-11-04T01:00', '2026-11-11T01:00']);
    }));
});

describe('live scoring', () => {
  it('lets staff and delegated adults score, rejects stale devices, and keeps finals final', () =>
    tx(async (t) => {
      await t.as('pat');
      expect(await t.fails('score_update', { p_event: EVENTS.blueGame, p_expected_version: 1, p_home: 1, p_away: 0, p_period: 1, p_clock: 600, p_status: 'live' })).toMatch(/not allowed/);
      await t.as('casey');
      await t.rpc('score_delegate', { p_team: TEAMS.u12Blue, p_person: PEOPLE.pat });
      // A fan is not an affiliated adult on the team.
      expect(await t.fails('score_delegate', { p_team: TEAMS.u12Blue, p_person: PEOPLE.gail })).toMatch(/coach or guardian/);
      await t.as('pat');
      const v2 = await t.rpc('score_update', { p_event: EVENTS.blueGame, p_expected_version: 1, p_home: 1, p_away: 0, p_period: 1, p_clock: 600, p_status: 'live' });
      expect(await t.fails('score_update', { p_event: EVENTS.blueGame, p_expected_version: 1, p_home: 0, p_away: 1, p_period: 1, p_clock: 600, p_status: 'live' })).toMatch(/another device/);
      const v3 = await t.rpc('score_update', { p_event: EVENTS.blueGame, p_expected_version: v2, p_home: 2, p_away: 1, p_period: 2, p_clock: 0, p_status: 'final' });
      expect(await t.fails('score_update', { p_event: EVENTS.blueGame, p_expected_version: v3, p_home: 2, p_away: 2, p_period: 2, p_clock: 0, p_status: 'live' })).toMatch(/head coach/);
      await t.as('casey');
      await t.rpc('score_update', { p_event: EVENTS.blueGame, p_expected_version: v3, p_home: 2, p_away: 2, p_period: 2, p_clock: 0, p_status: 'final' });
    }));
});

describe('fees and payments', () => {
  it('shows a parent only their own children’s fees', () =>
    tx(async (t) => {
      await t.as('pat');
      const fees = await t.rpc('my_fees');
      expect(fees.map((f: any) => f.athlete)).toEqual(['Mia L.']);
      expect(fees[0].installments).toHaveLength(3);
      await t.as('riley');
      expect(await t.rpc('my_fees')).toEqual([]);
    }));

  it('splits a fee into installments with the remainder on the first', () =>
    tx(async (t) => {
      await t.as('dana');
      const r = await t.rpc('fee_schedule_create', { p_org: ORGS.frontRange, p_team: TEAMS.u15Red, p_name: 'Uniform', p_kind: 'installment_plan', p_amount_cents: 10000, p_installments: 3, p_first_due: '2026-12-01' });
      expect(r.invoices).toBe(1);
      const rows = await t.sql<{ amount_cents: number }>('select n.amount_cents from public.installments n join public.invoices i on i.id = n.invoice_id where i.fee_schedule_id = $1 order by seq', [r.fee_schedule_id]);
      expect(rows.map((x) => x.amount_cents)).toEqual([3334, 3333, 3333]);
      await t.as('casey');
      expect(await t.fails('fee_schedule_create', { p_org: ORGS.frontRange, p_team: TEAMS.u12Blue, p_name: 'x', p_kind: 'ad_hoc', p_amount_cents: 100, p_installments: 1, p_first_due: '2026-12-01' })).toMatch(/not allowed/);
    }));

  it('is idempotent at checkout and ignores webhook replays', () =>
    tx(async (t) => {
      const inst = await firstInstallment(t, INVOICES.mia);
      await t.as('pat');
      const key = 'pay-mia-installment-1-abc';
      const a = await t.rpc('payment_start', { p_installment: inst, p_idempotency_key: key });
      const b = await t.rpc('payment_start', { p_installment: inst, p_idempotency_key: key });
      expect(b.payment_id).toBe(a.payment_id);
      expect(b.replayed).toBe(true);
      expect(await t.fails('payment_start', { p_installment: inst, p_idempotency_key: 'a-different-key-123' })).toMatch(/already in progress/);
      await t.as('riley');
      expect(await t.fails('payment_start', { p_installment: inst, p_idempotency_key: key })).toMatch(/reused/);

      // The parent cannot mark their own payment as paid.
      await t.as('pat');
      expect(await t.fails('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_1', p_provider_ref: a.provider_ref, p_outcome: 'succeeded' }, 'app')).toMatch(/permission denied|not allowed/);

      await t.asService();
      expect(await t.rpc('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_1', p_provider_ref: a.provider_ref, p_outcome: 'succeeded' }, 'app')).toBe('applied');
      expect(await t.rpc('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_1', p_provider_ref: a.provider_ref, p_outcome: 'succeeded' }, 'app')).toBe('replay_ignored');
      expect(await t.rpc('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_2', p_provider_ref: a.provider_ref, p_outcome: 'failed' }, 'app')).toBe('ignored_after_success');

      await t.as('pat');
      const [fee] = await t.rpc('my_fees');
      expect(fee).toMatchObject({ status: 'partially_paid', paid_cents: 15000 });
      expect(fee.installments[0].status).toBe('paid');
    }));

  it('has no column that could hold card data', () =>
    tx(async (t) => {
      await t.asAdmin();
      const cols = await t.sql<{ column_name: string }>(`select column_name from information_schema.columns where table_schema in ('public','private') and column_name ~* '(card|cvc|cvv|pan|expiry)'`);
      expect(cols).toEqual([]);
    }));

  it('requires finance permission to record an offline payment, and audits it', () =>
    tx(async (t) => {
      const inst = await firstInstallment(t, INVOICES.ava);
      await t.as('casey');
      expect(await t.fails('payment_record_offline', { p_installment: inst, p_method: 'offline_check', p_note: 'check 1001', p_idempotency_key: 'offline-ava-1-xyz00' })).toMatch(/not allowed/);
      await t.as('dana');
      const id1 = await t.rpc('payment_record_offline', { p_installment: inst, p_method: 'offline_check', p_note: 'check 1001', p_idempotency_key: 'offline-ava-1-xyz00' });
      const id2 = await t.rpc('payment_record_offline', { p_installment: inst, p_method: 'offline_check', p_note: 'check 1001', p_idempotency_key: 'offline-ava-1-xyz00' });
      expect(id2).toBe(id1);
      const summary = await t.rpc('org_finance_summary', { p_org: ORGS.frontRange });
      expect(summary).toBeTruthy();
    }));
});

describe('forms, compliance and tryouts', () => {
  it('signs the current version of a form only', () =>
    tx(async (t) => {
      await t.as('pat');
      const forms = await t.rpc('my_forms');
      expect(forms.filter((f: any) => !f.signed_at).map((f: any) => `${f.athlete}:${f.title}`).sort()).toEqual(
        ['Leo:Family code of conduct', 'Leo:Participation waiver', 'Mia:Family code of conduct']);
      expect(await t.fails('document_sign', { p_document: DOCUMENTS.conduct, p_athlete: ATHLETES.mia, p_typed_name: 'Pat Parent', p_document_version: 0 })).toMatch(/updated/);
      await t.rpc('document_sign', { p_document: DOCUMENTS.conduct, p_athlete: ATHLETES.mia, p_typed_name: 'Pat Parent', p_document_version: 1 });
      expect(await t.fails('document_sign', { p_document: DOCUMENTS.conduct, p_athlete: ATHLETES.ava, p_typed_name: 'Pat Parent', p_document_version: 1 })).toMatch(/only a guardian/);
    }));

  it('shows the director certification gaps', () =>
    tx(async (t) => {
      await t.as('dana');
      const c = await t.rpc('compliance_overview', { p_org: ORGS.frontRange });
      const gaps = c.certifications.filter((x: any) => x.gap).map((x: any) => `${x.person}:${x.kind}`).sort();
      expect(gaps).toEqual(['Alex Assistant:safesport', 'Casey Coach:safesport']);
    }));

  it('runs a tryout from signup to an accepted offer, with placement made by a person', () =>
    tx(async (t) => {
      await t.as('pat');
      const signup = await t.rpc('tryout_signup', { p_tryout: TRYOUTS.spring, p_athlete: ATHLETES.mia });
      expect((await t.rpc('my_fees')).map((f: any) => f.description)).toContain('Tryout fee: Spring 2027 U13 tryouts');
      // Families cannot read evaluator scores.
      await t.as('dana');
      await t.rpc('tryout_score', { p_signup: signup, p_scores: { first_touch: 4, passing: 3, vision: 4, effort: 5 }, p_notes: 'strong' });
      await t.as('pat');
      expect(await t.sqlFails('select * from public.tryout_scores')).toMatch(/permission denied/);
      expect(await t.fails('tryout_board', { p_tryout: TRYOUTS.spring })).toMatch(/not allowed/);
      await t.as('dana', { agent: true });
      expect(await t.fails('tryout_offer', { p_signup: signup, p_team: TEAMS.u12Blue })).toMatch(/needs a person/);
      await t.as('dana');
      const board = await t.rpc('tryout_board', { p_tryout: TRYOUTS.spring });
      expect(board.rows[0]).toMatchObject({ athlete: 'Mia L.', avg_total: 16, evaluations: 1 });
      const offer = await t.rpc('tryout_offer', { p_signup: signup, p_team: TEAMS.u12Blue });
      await t.as('pat');
      await t.rpc('tryout_offer_respond', { p_offer: offer, p_accept: true, p_jersey: '11' });
      const mine = await t.rpc('my_tryouts');
      expect(JSON.stringify(mine)).toContain('accepted');
    }));
});
