import { afterAll, describe, expect, it } from 'vitest';
import { AUTH, ATHLETES, EVENTS, ORGS, PEOPLE, TEAMS } from '../src/seed-ids.js';
import { endPool, j, tx, type Tx } from './harness.js';

afterAll(endPool);

async function teamConversation(t: Tx, team: string) {
  await t.as('casey');
  const id = await t.rpc('announcement_post', { p_team: team, p_title: 'Welcome', p_body: 'Season starts soon.', p_emergency: false, p_reason: null });
  await t.asAdmin();
  const [m] = await t.sql<{ conversation_id: string }>('select conversation_id from public.messages where id = $1', [id]);
  return m!.conversation_id;
}

/** Adds n synthetic adult guardians to Mia's team so survey thresholds can be reached. */
async function addGuardians(t: Tx, n: number) {
  await t.asAdmin();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [u] = await t.sql<{ id: string }>(`insert into auth.users(id, email) values (gen_random_uuid(), $1) returning id`, [`extra${i}@example.test`]);
    const [p] = await t.sql<{ id: string }>(`insert into public.people(auth_user_id, display_name, email) values ($1, $2, $3) returning id`, [u!.id, `Extra Parent ${i}`, `extra${i}@example.test`]);
    const [a] = await t.sql<{ id: string }>(`insert into public.athletes(first_name, last_initial, age_band) values ($1, 'X', 'under_13') returning id`, [`Kid${i}`]);
    await t.sql(`insert into public.guardianships(athlete_id, guardian_person_id, status) values ($1, $2, 'active')`, [a!.id, p!.id]);
    await t.sql(`insert into public.roster_entries(team_id, athlete_id, status) values ($1, $2, 'active')`, [TEAMS.u12Blue, a!.id]);
    ids.push(u!.id);
  }
  return ids;
}

async function asAuth(t: Tx, authId: string) {
  await t.client.query('reset role');
  await t.client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authId, role: 'authenticated' })]);
  await t.client.query('set local role authenticated');
}

describe('direct messages', () => {
  it('never opens a private conversation between an adult and a minor', () =>
    tx(async (t) => {
      await t.as('jordan');
      expect(await t.fails('dm_start', { p_other: PEOPLE.leo })).toMatch(/under 18/);
      await t.as('leo');
      expect(await t.fails('dm_start', { p_other: PEOPLE.jordan })).toMatch(/under 18/);
    }));

  it('lets adults who share a team message each other, and nobody else', () =>
    tx(async (t) => {
      await t.as('pat');
      const c = await t.rpc('dm_start', { p_other: PEOPLE.casey });
      expect(await t.rpc('dm_start', { p_other: PEOPLE.casey })).toBe(c);
      expect(await t.fails('dm_start', { p_other: PEOPLE.olivia })).toMatch(/share a team/);
      await t.rpc('message_post', { p_conversation: c, p_body: 'Can Mia leave early Thursday?' });
      await t.as('riley');
      expect(await t.fails('conversation_messages', { p_conversation: c })).toMatch(/not allowed/);
      await t.as('casey');
      const msgs = await t.rpc('conversation_messages', { p_conversation: c });
      expect(msgs.map((m: any) => m.body)).toEqual(['Can Mia leave early Thursday?']);
    }));
});

describe('team conversation', () => {
  it('reaches families and the teen, not other teams', () =>
    tx(async (t) => {
      const conv = await teamConversation(t, TEAMS.u12Blue);
      await t.as('pat');
      expect((await t.rpc('conversation_messages', { p_conversation: conv })).map((m: any) => m.title)).toEqual(['Welcome']);
      await t.as('olivia');
      expect(await t.fails('conversation_messages', { p_conversation: conv })).toMatch(/not allowed/);
    }));

  it('respects announcements-only mode for families but not staff', () =>
    tx(async (t) => {
      const conv = await teamConversation(t, TEAMS.u12Blue);
      await t.asAdmin();
      await t.sql(`update public.teams set messaging_mode = 'announcements_only' where id = $1`, [TEAMS.u12Blue]);
      await t.as('pat');
      expect(await t.fails('message_post', { p_conversation: conv, p_body: 'hi all' })).toMatch(/announcements only/);
      await t.as('casey');
      await t.rpc('message_post', { p_conversation: conv, p_body: 'Bring water.' });
    }));

  it('holds messages that trip the filter until a moderator decides', () =>
    tx(async (t) => {
      const conv = await teamConversation(t, TEAMS.u12Blue);
      await t.as('pat');
      await t.rpc('message_post', { p_conversation: conv, p_body: 'that ref was an idiot' });
      await t.as('jordan');
      expect((await t.rpc('conversation_messages', { p_conversation: conv })).map((m: any) => m.body)).not.toContain('that ref was an idiot');
      await t.as('casey');
      const q = await t.rpc('moderation_queue', { p_team: TEAMS.u12Blue });
      expect(q.length).toBe(1);
    }));

  it('defers push and SMS in quiet hours, except for an emergency with a reason', () =>
    tx(async (t) => {
      await t.asAdmin();
      // Make Pat's quiet hours cover the whole day.
      await t.sql(`update public.notification_prefs set quiet_start = '00:00', quiet_end = '23:59', sms = true where person_id = $1`, [PEOPLE.pat]);
      await t.as('casey');
      const normal = await t.rpc('announcement_post', { p_team: TEAMS.u12Blue, p_title: 'Kit', p_body: 'Wear blue.', p_emergency: false, p_reason: null });
      expect(await t.fails('announcement_post', { p_team: TEAMS.u12Blue, p_title: 'Field closed', p_body: 'Lightning.', p_emergency: true, p_reason: '' })).toMatch(/need a reason/);
      const urgent = await t.rpc('announcement_post', { p_team: TEAMS.u12Blue, p_title: 'Field closed', p_body: 'Lightning.', p_emergency: true, p_reason: 'lightning on site' });
      await t.asAdmin();
      const st = async (m: string) => Object.fromEntries((await t.sql<{ channel: string; status: string }>(
        'select channel, status from public.deliveries where message_id = $1 and person_id = $2', [m, PEOPLE.pat])).map((r) => [r.channel, r.status]));
      expect(await st(normal)).toEqual({ in_app: 'delivered', push: 'deferred_quiet_hours', email: 'queued', sms: 'deferred_quiet_hours' });
      expect(await st(urgent)).toEqual({ in_app: 'delivered', push: 'queued', email: 'queued', sms: 'queued' });
      // One outbox row per recipient and channel, never duplicated.
      const [o] = await t.sql<{ n: string; d: string }>(`select count(*) n, count(distinct dedupe_key) d from public.outbox where ref_id = $1`, [urgent]);
      expect(o!.n).toBe(o!.d);
    }));
});

describe('SMS and email RSVP replies', () => {
  it('applies Y/N replies through a scoped token, once, and re-checks the relationship', () =>
    tx(async (t) => {
      await t.asAdmin();
      const tok = (await t.sql<{ tok: string }>(`select app.rsvp_link_create($1, $2, $3, 'sms') tok`, [EVENTS.blueGame, ATHLETES.mia, PEOPLE.pat]))[0]!.tok;
      await t.as('pat');
      expect(await t.fails('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm1', p_token: tok, p_text: 'Y' }, 'app')).toMatch(/permission denied|not allowed/);
      await t.asService();
      expect(await t.rpc('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm1', p_token: tok, p_text: 'Y' }, 'app')).toBe('applied:yes');
      expect(await t.rpc('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm1', p_token: tok, p_text: 'N' }, 'app')).toBe('replay_ignored');
      expect(await t.rpc('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm2', p_token: 'guess', p_text: 'N' }, 'app')).toBe('invalid_or_expired');
      expect(await t.rpc('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm3', p_token: tok, p_text: 'whatever' }, 'app')).toBe('unrecognized');
      await t.asAdmin();
      await t.sql(`update public.guardianships set status = 'revoked' where athlete_id = $1 and guardian_person_id = $2`, [ATHLETES.mia, PEOPLE.pat]);
      await t.asService();
      expect(await t.rpc('rsvp_apply_reply', { p_provider: 'sandbox_sms', p_provider_message_id: 'm4', p_token: tok, p_text: 'N' }, 'app')).toBe('relationship_revoked');
    }));
});

describe('polls', () => {
  it('limits captain elections to athletes on the roster', () =>
    tx(async (t) => {
      await t.as('jordan');
      const poll = await t.rpc('poll_create', { p_team: TEAMS.u15Red, p_kind: 'captain_election', p_question: 'Captain?', p_options: j(['Leo', 'Sam']), p_closes: new Date(Date.now() + 86400e3) });
      await t.as('pat');
      expect(await t.fails('poll_vote', { p_poll: poll, p_option: 0 })).toMatch(/only athletes/);
      await t.as('leo');
      await t.rpc('poll_vote', { p_poll: poll, p_option: 0 });
      expect((await t.rpc('poll_results', { p_poll: poll })).my_vote).toBe(0);
    }));
});

describe('feedback and anonymity', () => {
  it('suppresses survey results below five responses and never exposes who answered', () =>
    tx(async (t) => {
      await t.as('casey');
      const survey = await t.rpc('survey_create', { p_team: TEAMS.u12Blue, p_kind: 'pulse', p_title: 'How is the season?', p_questions: [{ key: 'fun', label: 'Fun (1-5)' }], p_closes: new Date(Date.now() + 86400e3), p_allow_anonymous: true });
      const extras = await addGuardians(t, 4);
      await t.as('pat');
      await t.rpc('survey_submit', { p_survey: survey, p_answers: { fun: 5 }, p_anonymous: true });
      expect(await t.fails('survey_submit', { p_survey: survey, p_answers: { fun: 1 }, p_anonymous: true })).toMatch(/already responded/);
      for (const [i, a] of extras.slice(0, 3).entries()) {
        await asAuth(t, a);
        await t.rpc('survey_submit', { p_survey: survey, p_answers: { fun: 3 + (i % 2) }, p_anonymous: true });
      }
      await t.as('casey');
      expect(await t.rpc('survey_summary', { p_survey: survey })).toEqual({ suppressed: true, responses: 4, minimum: 5 });
      await asAuth(t, extras[3]!);
      await t.rpc('survey_submit', { p_survey: survey, p_answers: { fun: 4 }, p_anonymous: true });
      await t.as('casey');
      const s = await t.rpc('survey_summary', { p_survey: survey });
      expect(s.suppressed).toBe(false);
      expect(s.questions[0].average).toBe(3.8);
      // Raw responses and the identity mapping stay out of reach.
      expect(await t.sqlFails('select * from public.survey_responses')).toMatch(/permission denied/);
      expect(await t.sqlFails('select * from private.survey_identity')).toMatch(/permission denied/);
    }));

  it('does not let teens or under-13s answer anonymously', () =>
    tx(async (t) => {
      await t.as('jordan');
      const survey = await t.rpc('survey_create', { p_team: TEAMS.u15Red, p_kind: 'pulse', p_title: 'Pulse', p_questions: [{ key: 'q', label: 'Q' }], p_closes: new Date(Date.now() + 86400e3), p_allow_anonymous: true });
      await t.as('leo');
      expect(await t.fails('survey_submit', { p_survey: survey, p_answers: { q: 4 }, p_anonymous: true })).toMatch(/under 18/);
      await t.rpc('survey_submit', { p_survey: survey, p_answers: { q: 4 }, p_anonymous: false });
    }));

  it('lets only the safeguarding reviewer resolve an anonymous reporter, with a reason, always audited', () =>
    tx(async (t) => {
      await t.as('pat');
      const report = await t.rpc('issue_report_submit', { p_team: TEAMS.u12Blue, p_category: 'conduct', p_body: 'Sideline behaviour at the last game.', p_anonymous: true, p_about_athlete: null });
      await t.as('casey');
      expect(await t.rpc('issue_reports_visible')).toEqual([]);
      await t.as('dana');
      expect(await t.rpc('issue_reports_visible')).toEqual([]);
      expect(await t.rpc('anonymous_identity_resolve', { p_kind: 'issue_report', p_id: report, p_reason: 'owner curiosity' })).toEqual({ allowed: false });
      await t.as('sam');
      const seen = await t.rpc('issue_reports_visible');
      expect(seen).toHaveLength(1);
      expect(seen[0].reporter).toBeNull();
      expect(await t.fails('anonymous_identity_resolve', { p_kind: 'issue_report', p_id: report, p_reason: 'short' })).toMatch(/reason/);
      expect(await t.rpc('anonymous_identity_resolve', { p_kind: 'issue_report', p_id: report, p_reason: 'safety follow-up required by policy' })).toEqual({ allowed: true, display_name: 'Pat Parent' });
      await t.asAdmin();
      const audits = await t.sql<{ action: string; actor_person_id: string }>(`select action, actor_person_id from public.audit_events where action like 'identity.%' order by action desc`);
      expect(audits).toEqual([
        { action: 'identity.resolve_denied', actor_person_id: PEOPLE.dana },
        { action: 'identity.resolve', actor_person_id: PEOPLE.sam },
      ]);
      expect(AUTH.sam).toBeTruthy();
      expect(ORGS.frontRange).toBeTruthy();
    }));
});
