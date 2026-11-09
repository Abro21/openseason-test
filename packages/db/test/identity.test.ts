import { afterAll, describe, expect, it } from 'vitest';
import { ATHLETES, ORGS, PEOPLE, TEAMS } from '../src/seed-ids.js';
import { endPool, tx } from './harness.js';

afterAll(endPool);

describe('contexts', () => {
  it('derives every context a multi-role person holds', () =>
    tx(async (t) => {
      await t.as('jordan');
      const c = await t.rpc('my_contexts', { p_tenant: ORGS.frontRange });
      expect(c.person.display_name).toBe('Jordan Multi');
      expect(c.teams.map((x: any) => [x.label, x.role])).toEqual([['U15 Red', 'head_coach']]);
      expect(c.family.map((x: any) => x.label)).toEqual(['Ava M.']);
      expect(c.clubs).toEqual([]);
    }));

  it('shows a parent both children and nothing else', () =>
    tx(async (t) => {
      await t.as('pat');
      const c = await t.rpc('my_contexts', { p_tenant: ORGS.frontRange });
      expect(c.family.map((x: any) => x.label).sort()).toEqual(['Leo L.', 'Mia L.']);
      expect(c.teams).toEqual([]);
      expect(c.clubs).toEqual([]);
    }));

  it('gives a teen an athlete context and a fan a fan context', () =>
    tx(async (t) => {
      await t.as('leo');
      expect((await t.rpc('my_contexts', { p_tenant: ORGS.frontRange })).athlete.map((x: any) => x.label)).toEqual(['Leo']);
      await t.as('gail');
      expect((await t.rpc('my_contexts', { p_tenant: ORGS.frontRange })).fan.map((x: any) => x.label)).toEqual(['Mia L.']);
    }));
});

describe('row security', () => {
  it('denies anonymous callers everything', () =>
    tx(async (t) => {
      await t.asAnon();
      expect(await t.sqlFails('select * from public.teams')).toMatch(/permission denied/);
      expect(await t.fails('my_contexts', { p_tenant: ORGS.frontRange })).toMatch(/permission denied/);
    }));

  it('blocks direct writes; all changes go through checked functions', () =>
    tx(async (t) => {
      await t.as('dana');
      expect(await t.sqlFails(`insert into public.teams(name) values ('Sneaky')`)).toMatch(/permission denied/);
      expect(await t.sqlFails(`update public.org_grants set permission = 'owner'`)).toMatch(/permission denied/);
      expect(await t.sqlFails(`delete from public.audit_events`)).toMatch(/permission denied/);
    }));

  it('keeps one club out of another club', () =>
    tx(async (t) => {
      await t.as('olivia');
      const teams = await t.sql<{ name: string }>('select name from public.teams order by name');
      expect(teams.map((r) => r.name)).toEqual(['U12 Gold']);
      expect(await t.sql('select * from public.athletes where id = $1', [ATHLETES.mia])).toEqual([]);
      expect(await t.sql('select * from public.invoices where org_id = $1', [ORGS.frontRange])).toEqual([]);
      expect(await t.rpc('team_roster', { p_team: TEAMS.u12Blue })).toEqual([]);
      expect(await t.fails('compliance_overview', { p_org: ORGS.frontRange })).toMatch(/not allowed/);
    }));

  it('shows people rows only to themselves; names come through scoped functions', () =>
    tx(async (t) => {
      await t.as('pat');
      const rows = await t.sql<{ id: string }>('select id from public.people');
      expect(rows.map((r) => r.id)).toEqual([PEOPLE.pat]);
    }));

  it('never exposes the private schema or dates of birth directly', () =>
    tx(async (t) => {
      await t.as('casey');
      expect(await t.sqlFails('select * from private.athlete_dob')).toMatch(/permission denied/);
      expect(await t.fails('athlete_dob_get', { p_athlete: ATHLETES.mia })).toMatch(/not allowed/);
      await t.as('pat');
      expect(String(await t.rpc('athlete_dob_get', { p_athlete: ATHLETES.mia }))).toMatch(/2015/);
      expect(await t.fails('athlete_dob_get', { p_athlete: ATHLETES.ava })).toMatch(/not allowed/);
    }));

  it('isolates families on the same team', () =>
    tx(async (t) => {
      await t.as('riley');
      const athletes = await t.sql<{ first_name: string }>('select first_name from public.athletes order by 1');
      expect(athletes.map((a) => a.first_name)).toEqual(['Noah']);
      expect(await t.sql('select * from public.guardianships where athlete_id = $1', [ATHLETES.mia])).toEqual([]);
      expect(await t.sql('select * from public.invoices where org_id = $1', [ORGS.frontRange])).toEqual([]);
      expect(await t.rpc('team_roster', { p_team: TEAMS.u12Blue })).toEqual([]);
    }));

  it('ignores client-supplied IDs it has no grant for', () =>
    tx(async (t) => {
      await t.as('pat');
      expect(await t.fails('athlete_create_for_team', { p_team: TEAMS.u12Blue, p_first: 'X', p_last_initial: 'Y', p_dob: '2015-01-01', p_jersey: null })).toMatch(/not allowed/);
      expect(await t.fails('org_grant', { p_org: ORGS.frontRange, p_person: PEOPLE.pat, p_permission: 'owner' })).toMatch(/not allowed|only an organization owner/);
      expect(await t.fails('invite_create', { p_kind: 'assistant_coach', p_email: 'x@example.test', p_team: TEAMS.u12Blue, p_athlete: null })).toMatch(/not allowed/);
    }));

  it('does not let the club owner read safeguarding material by default', () =>
    tx(async (t) => {
      await t.as('dana');
      const c = await t.rpc('my_contexts', { p_tenant: ORGS.frontRange });
      expect(c.clubs[0].permissions).toEqual(['owner']);
      const r = await t.rpc('anonymous_identity_resolve', { p_kind: 'issue_report', p_id: PEOPLE.pat, p_reason: 'checking access path' });
      expect(r).toEqual({ allowed: false });
    }));

  it('removes access as soon as a grant is revoked', () =>
    tx(async (t) => {
      await t.as('dana');
      await t.rpc('org_grant', { p_org: ORGS.frontRange, p_person: PEOPLE.alex, p_permission: 'manage_compliance' });
      await t.as('alex');
      expect(await t.rpc('compliance_overview', { p_org: ORGS.frontRange })).toBeTruthy();
      await t.asAdmin();
      const [g] = await t.sql<{ id: string }>(`select id from public.org_grants where person_id = $1 and permission = 'manage_compliance'`, [PEOPLE.alex]);
      await t.as('dana');
      await t.rpc('org_revoke_grant', { p_grant: g!.id, p_reason: 'role ended' });
      await t.as('alex');
      expect(await t.fails('compliance_overview', { p_org: ORGS.frontRange })).toMatch(/not allowed/);
    }));
});

describe('invitations and claims', () => {
  it('needs a valid token and staff approval; an email match is only a hint', () =>
    tx(async (t) => {
      await t.as('casey');
      const [inv] = await t.rpc('invite_create', { p_kind: 'guardian', p_email: 'Quinn.Newcomer@example.test ', p_team: TEAMS.u12Blue, p_athlete: ATHLETES.noah });

      await t.as('quinn');
      const cands = await t.rpc('my_claim_candidates');
      expect(cands).toHaveLength(1);
      expect(Object.keys(cands[0]).sort()).toEqual(['expires_at', 'invitation_id', 'invited_by_name', 'kind', 'team_name']);
      expect((await t.rpc('claim_submit', { p_token: 'not-the-token' }))[0].status).toBe('invalid');
      const [claim] = await t.rpc('claim_submit', { p_token: inv.token });
      expect(claim.status).toBe('pending_approval');
      // No access before approval.
      expect(await t.sql('select * from public.athletes where id = $1', [ATHLETES.noah])).toEqual([]);

      await t.as('casey');
      const pending = await t.rpc('team_pending_claims', { p_team: TEAMS.u12Blue });
      expect(pending.map((p: any) => p.claimant_name)).toContain('Quinn Newcomer');
      await t.rpc('claim_decide', { p_claim: claim.claim_id, p_approve: true });

      await t.as('quinn');
      expect((await t.rpc('my_contexts', { p_tenant: ORGS.frontRange })).family.map((f: any) => f.label)).toEqual(['Noah P.']);
      // Token cannot be reused.
      expect((await t.rpc('claim_submit', { p_token: inv.token }))[0].status).toBe('invalid');
    }));

  it('flags a second claimant as a conflict', () =>
    tx(async (t) => {
      await t.as('casey');
      const [inv] = await t.rpc('invite_create', { p_kind: 'guardian', p_email: 'quinn.newcomer@example.test', p_team: TEAMS.u12Blue, p_athlete: ATHLETES.noah });
      await t.as('quinn');
      await t.rpc('claim_submit', { p_token: inv.token });
      await t.as('gail');
      const [c2] = await t.rpc('claim_submit', { p_token: inv.token });
      expect(c2.status).toBe('conflict');
      await t.asAdmin();
      const rows = await t.sql<{ status: string }>('select status from public.claims where invitation_id = $1', [inv.invitation_id]);
      expect(rows.map((r) => r.status)).toEqual(['conflict', 'conflict']);
    }));

  it('does not let staff approve their own claim', () =>
    tx(async (t) => {
      await t.as('casey');
      const [inv] = await t.rpc('invite_create', { p_kind: 'guardian', p_email: 'casey.coach@example.test', p_team: TEAMS.u12Blue, p_athlete: ATHLETES.noah });
      const [claim] = await t.rpc('claim_submit', { p_token: inv.token });
      expect(await t.fails('claim_decide', { p_claim: claim.claim_id, p_approve: true })).toMatch(/own claim/);
    }));

  it('rate-limits claim attempts', () =>
    tx(async (t) => {
      await t.as('quinn');
      for (let i = 0; i < 10; i++) expect((await t.rpc('claim_submit', { p_token: `guess-${i}` }))[0].status).toBe('invalid');
      expect(await t.fails('claim_submit', { p_token: 'guess-11' })).toMatch(/too many/i);
    }));
});

describe('age bands and consent', () => {
  it('keeps an under-13 athlete inactive until consent is verified by the provider path', () =>
    tx(async (t) => {
      await t.as('riley');
      const ref = await t.rpc('consent_guardian_start', { p_athlete: ATHLETES.noah });
      // The guardian cannot mark it verified themselves.
      expect(await t.fails('consent_provider_verified', { p_ref: ref, p_method: 'provider_verified' }, 'app')).toMatch(/permission denied|not allowed/);
      await t.asService();
      expect(await t.fails('consent_provider_verified', { p_ref: ref, p_method: 'checkbox' }, 'app')).toMatch(/not acceptable/);
      await t.rpc('consent_provider_verified', { p_ref: ref, p_method: 'provider_verified' }, 'app');
      await t.as('casey');
      const roster = await t.rpc('team_roster', { p_team: TEAMS.u12Blue });
      expect(roster.find((r: any) => r.first_name === 'Noah')).toMatchObject({ status: 'active', consent: 'verified' });
    }));

  it('revoking a guardian also ends the fan follows they created', () =>
    tx(async (t) => {
      await t.as('pat');
      const [g] = await t.sql<{ id: string }>('select id from public.guardianships where athlete_id = $1', [ATHLETES.mia]);
      await t.rpc('guardianship_revoke', { p_guardianship: g!.id, p_reason: 'test' });
      await t.as('gail');
      expect((await t.rpc('my_tenants')).tenants).toEqual([]);
    }));
});

describe('audit', () => {
  it('records sensitive actions with the acting person and is not readable by families', () =>
    tx(async (t) => {
      await t.as('dana');
      await t.rpc('org_grant', { p_org: ORGS.frontRange, p_person: PEOPLE.alex, p_permission: 'communicate' });
      await t.asAdmin();
      const [a] = await t.sql<{ actor_person_id: string; actor_kind: string }>(
        `select actor_person_id, actor_kind from public.audit_events where action = 'grant.create' order by at desc limit 1`);
      expect(a).toEqual({ actor_person_id: PEOPLE.dana, actor_kind: 'person' });
      await t.as('pat');
      expect(await t.sql('select * from public.audit_events')).toEqual([]);
    }));
});
