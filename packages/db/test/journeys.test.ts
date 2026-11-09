// The five end-to-end journeys, each run against the real database as the
// people involved. Everything is rolled back afterwards.
import { afterAll, describe, expect, it } from 'vitest';
import { ATHLETES, EVENTS, ORGS, PEOPLE, TEAMS, TRYOUTS } from '../src/seed-ids.js';
import { endPool, j, tx, type Tx } from './harness.js';

afterAll(endPool);

const k = (s: string) => `${s}-journey-key-0000000`;
const window = () => ({ p_from: new Date(Date.now() - 86400e3), p_to: new Date(Date.now() + 60 * 86400e3) });

async function approveAll(t: Tx, who: 'casey' | 'dana', ids: string[]) {
  await t.as(who);
  const items = [];
  for (const id of ids) {
    const a = await t.rpc('action_get', { p_id: id });
    items.push({ id, revision: a.revision, hash: a.payload_hash });
  }
  return t.rpc('actions_approve_batch', { p_items: items, p_batch_key: k(`batch-${ids.length}-${who}`) });
}

describe('journeys', () => {
  it('1. a new parent joins, gets verified consent, RSVPs, signs forms and pays', () =>
    tx(async (t) => {
      // Coach adds a new athlete and invites the guardian.
      await t.as('casey');
      const kid = await t.rpc('athlete_create_for_team', { p_team: TEAMS.u12Blue, p_first: 'Ivy', p_last_initial: 'N', p_dob: '2016-02-02', p_jersey: '21' });
      const [inv] = await t.rpc('invite_create', { p_kind: 'guardian', p_email: 'quinn.newcomer@example.test', p_team: TEAMS.u12Blue, p_athlete: kid });

      // Quinn sees a candidate, claims with the token, and waits for approval.
      await t.as('quinn');
      expect((await t.rpc('my_claim_candidates'))[0].team_name).toBe('U12 Blue');
      const [claim] = await t.rpc('claim_submit', { p_token: inv.token });
      await t.as('casey');
      await t.rpc('claim_decide', { p_claim: claim.claim_id, p_approve: true });

      // Under 13: inactive until consent is verified through the provider path.
      await t.as('quinn');
      expect(await t.fails('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: kid, p_status: 'yes' })).toMatch(/not active/);
      const ref = await t.rpc('consent_guardian_start', { p_athlete: kid });
      await t.asService();
      await t.rpc('consent_provider_verified', { p_ref: ref, p_method: 'provider_verified' }, 'app');

      await t.as('quinn');
      await t.rpc('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: kid, p_status: 'yes' });
      for (const f of (await t.rpc('my_forms', { p_tenant: ORGS.frontRange })).filter((x: any) => !x.signed_at)) {
        await t.rpc('document_sign', { p_document: f.document_id, p_athlete: kid, p_typed_name: 'Quinn Newcomer', p_document_version: f.version });
      }
      expect((await t.rpc('my_forms', { p_tenant: ORGS.frontRange })).every((x: any) => x.signed_at)).toBe(true);

      // Director bills the team; Quinn pays the first installment in the sandbox.
      await t.as('dana');
      await t.rpc('fee_schedule_create', { p_org: ORGS.frontRange, p_team: TEAMS.u12Blue, p_name: 'Tournament', p_kind: 'ad_hoc', p_amount_cents: 6000, p_installments: 2, p_first_due: '2026-12-01' });
      await t.as('quinn');
      const [fee] = await t.rpc('my_fees', { p_tenant: ORGS.frontRange });
      const pay = await t.rpc('payment_start', { p_installment: fee.installments[0].id, p_idempotency_key: k('quinn-pay') });
      await t.asService();
      await t.rpc('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_quinn', p_provider_ref: pay.provider_ref, p_outcome: 'succeeded' }, 'app');
      await t.as('quinn');
      const [after] = await t.rpc('my_fees', { p_tenant: ORGS.frontRange });
      expect(after).toMatchObject({ status: 'partially_paid', paid_cents: 3000 });
      expect(after.receipts[0]).toMatchObject({ status: 'succeeded', amount_cents: 3000 });
    }));

  it('2. a coach plans practice with staff help, takes attendance, reminds families and scores the game', () =>
    tx(async (t) => {
      await t.as('casey');
      expect(await t.rpc('event_series_create', { p_team: TEAMS.u12Blue, p_kind: 'practice', p_title: 'Thursday practice', p_weekdays: [4], p_start_time: '17:30', p_duration_minutes: 75, p_from: '2026-11-12', p_until: '2026-12-10', p_location: 'Field 3' })).toBe(5);

      await t.as('casey', { agent: true });
      const plan = await t.rpc('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u12Blue } });
      await t.as('casey');
      const w = await t.rpc('prepared_work_get', { p_id: plan });
      const blocks = w.artifact.blocks.map((b: any, i: number) => (i === 0 ? { ...b, minutes: 12 } : b));
      const saved = await t.rpc('practice_plan_save', { p_plan: { ...w.artifact, blocks, source_prepared_work_id: plan } });
      await t.rpc('prepared_work_mark_saved', { p_id: plan, p_plan: saved.id });

      await t.rpc('attendance_record', { p_event: EVENTS.bluePractice1, p_athlete: ATHLETES.mia, p_status: 'present' });
      await t.rpc('attendance_record', { p_event: EVENTS.bluePractice1, p_athlete: ATHLETES.ava, p_status: 'late' });

      await t.as('casey', { agent: true });
      const rem = await t.rpc('staff_prepare', { p_kind: 'attendance_reminder', p_target: { event_id: EVENTS.blueGame } });
      const action = await t.rpc('prepared_work_propose', { p_id: rem });
      const res = await approveAll(t, 'casey', [action]);
      expect(res.results[0].ok).toBe(true);
      await t.asService();
      await t.rpc('process_queued_actions', { p_limit: 10 }, 'app');

      await t.as('pat');
      const convs = await t.rpc('my_conversations', { p_tenant: ORGS.frontRange, p_search: 'Casey', p_archived: false });
      expect(convs.length).toBe(1);
      await t.rpc('rsvp_set', { p_event: EVENTS.blueGame, p_athlete: ATHLETES.mia, p_status: 'yes' });

      await t.as('casey');
      const v = await t.rpc('score_update', { p_event: EVENTS.blueGame, p_expected_version: 1, p_home: 3, p_away: 2, p_period: 2, p_clock: 0, p_status: 'final' });
      expect(v).toBe(2);
      await t.as('gail');
      const game = (await t.rpc('team_schedule', { p_team: TEAMS.u12Blue, ...window() })).find((e: any) => e.id === EVENTS.blueGame);
      expect(game.score).toMatchObject({ home: 3, away: 2, status: 'final' });
    }));

  it('3. a director runs fees, compliance and tryouts, approving staff work in a batch', () =>
    tx(async (t) => {
      await t.as('dana');
      // Make one installment overdue so there is something to remind about.
      await t.asAdmin();
      await t.sql(`update public.installments set due_on = current_date - 3 where seq = 1`);
      await t.as('dana', { agent: true });
      const fee = await t.rpc('staff_prepare', { p_kind: 'fee_reminder', p_target: { org_id: ORGS.frontRange } });
      const cert = await t.rpc('staff_prepare', { p_kind: 'certification_nudge', p_target: { org_id: ORGS.frontRange } });
      await t.as('dana');
      const feeWork = await t.rpc('prepared_work_get', { p_id: fee });
      // The shared text names no amount.
      expect(feeWork.artifact.body).not.toMatch(/\$|\d{2,}\.\d\d/);
      const a1 = await t.rpc('prepared_work_propose', { p_id: fee });
      const a2 = await t.rpc('prepared_work_propose', { p_id: cert });
      const res = await approveAll(t, 'dana', [a1, a2]);
      expect(res.results.every((r: any) => r.ok)).toBe(true);
      await t.asService();
      const out = await t.rpc('process_queued_actions', { p_limit: 10 }, 'app');
      expect(out.map((o: any) => o.result)).toEqual(['succeeded', 'succeeded']);

      await t.as('dana');
      const comp = await t.rpc('compliance_overview', { p_org: ORGS.frontRange });
      expect(comp.certifications.length).toBeGreaterThan(0);
      expect(await t.rpc('org_finance_summary', { p_org: ORGS.frontRange })).toBeTruthy();

      await t.as('jordan');
      const signup = await t.rpc('tryout_signup', { p_tryout: TRYOUTS.spring, p_athlete: ATHLETES.ava });
      await t.as('dana');
      await t.rpc('tryout_score', { p_signup: signup, p_scores: { first_touch: 5, passing: 4, vision: 4, effort: 5 }, p_notes: '' });
      const offer = await t.rpc('tryout_offer', { p_signup: signup, p_team: TEAMS.u15Red });
      await t.as('jordan');
      await t.rpc('tryout_offer_respond', { p_offer: offer, p_accept: true, p_jersey: '8' });
      await t.as('dana');
      expect((await t.rpc('tryout_board', { p_tryout: TRYOUTS.spring })).rows[0].offer).toMatchObject({ team: 'U15 Red', status: 'accepted', jersey_request: '8' });
    }));

  it('4. a teen athlete manages their own schedule, votes, and is protected from private adult messages', () =>
    tx(async (t) => {
      await t.as('leo');
      const sched = await t.rpc('team_schedule', { p_team: TEAMS.u15Red, ...window() });
      expect(sched.find((e: any) => e.id === EVENTS.redGame).location).toBeTruthy();
      await t.rpc('rsvp_set', { p_event: EVENTS.redGame, p_athlete: ATHLETES.leo, p_status: 'yes' });
      expect(await t.fails('dm_start', { p_other: PEOPLE.jordan, p_tenant: ORGS.frontRange })).toMatch(/under 18/);
      await t.as('jordan');
      const poll = await t.rpc('poll_create', { p_team: TEAMS.u15Red, p_kind: 'captain_election', p_question: 'Who should captain?', p_options: j(['Leo', 'Other']), p_closes: new Date(Date.now() + 86400e3) });
      await t.as('leo');
      await t.rpc('poll_vote', { p_poll: poll, p_option: 0 });
      // The guardian sees what the teen sees for the shared schedule.
      await t.as('pat');
      const fam = (await t.rpc('team_schedule', { p_team: TEAMS.u15Red, ...window() })).find((e: any) => e.id === EVENTS.redGame);
      expect(fam.my_rsvps).toEqual([{ athlete_id: ATHLETES.leo, athlete: 'Leo', status: 'yes' }]);
    }));

  it('5. a fan follows one athlete, sees limited information, and loses access when removed', () =>
    tx(async (t) => {
      await t.as('pat');
      const [inv] = await t.rpc('invite_create', { p_kind: 'fan', p_email: 'quinn.newcomer@example.test', p_team: TEAMS.u15Red, p_athlete: ATHLETES.leo });
      await t.as('quinn');
      const [c] = await t.rpc('claim_submit', { p_token: inv.token });
      expect(c.status).toBe('approved');
      const sched = await t.rpc('team_schedule', { p_team: TEAMS.u15Red, ...window() });
      expect(sched.every((e: any) => e.location === null && e.my_rsvps.length === 0)).toBe(true);
      expect(await t.rpc('team_roster', { p_team: TEAMS.u15Red })).toEqual([]);
      expect(await t.fails('team_schedule', { p_team: TEAMS.u12Blue, ...window() })).toMatch(/not allowed/);
      await t.as('pat');
      await t.asAdmin();
      const [f] = await t.sql<{ id: string }>('select id from public.fan_follows where fan_person_id = $1', [PEOPLE.quinn]);
      await t.as('pat');
      await t.rpc('fan_follow_revoke', { p_follow: f!.id });
      await t.as('quinn');
      expect(await t.fails('team_schedule', { p_team: TEAMS.u15Red, ...window() })).toMatch(/not allowed/);
    }));
});
