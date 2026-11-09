// Clubs are tenants: every list is read inside one club the person belongs to,
// and staff work stays inside the club it was prepared in.
import { afterAll, describe, expect, it } from 'vitest';
import { ATHLETES, INVOICES, ORGS, PEOPLE, TEAMS } from '../src/seed-ids.js';
import { endPool, tx } from './harness.js';

afterAll(endPool);
const FR = ORGS.frontRange;
const MV = ORGS.mesaValley;

describe('tenants', () => {
  it('lists every club a person belongs to, with their roles and scopes in each', () =>
    tx(async (t) => {
      const brief = (r: any) => r.tenants.map(({ contexts: _contexts, ...x }: any) => x);
      await t.as('pat');
      const pat = await t.rpc('my_tenants');
      expect(brief(pat)).toEqual([
        { id: FR, kind: 'club', name: 'Front Range FC', roles: ['family'] },
        { id: MV, kind: 'club', name: 'Mesa Valley SC', roles: ['family'] },
      ]);
      expect(pat.tenants[1].contexts.family.map((f: any) => f.label)).toEqual(['Nora L.']);
      expect(pat.tenants[0].contexts.family.map((f: any) => f.label)).toEqual(['Leo L.', 'Mia L.']);

      // One person, several roles in one club: coach of U15 Red and parent of Ava.
      await t.as('jordan');
      const jordan = await t.rpc('my_tenants');
      expect(brief(jordan)).toEqual([{ id: FR, kind: 'club', name: 'Front Range FC', roles: ['coach', 'family'] }]);
      expect(jordan.tenants[0].contexts.teams.map((x: any) => x.team_id)).toEqual([TEAMS.u15Red]);
      expect(jordan.tenants[0].contexts.family.map((x: any) => x.athlete_id)).toEqual([ATHLETES.ava]);

      // Club director and coach in one club: Olivia runs Mesa Valley and coaches U12 Gold.
      await t.as('olivia');
      const olivia = (await t.rpc('my_tenants')).tenants[0].contexts;
      expect(olivia.clubs.map((x: any) => x.org_id)).toEqual([MV]);
      expect(olivia.teams.map((x: any) => x.team_id)).toEqual([TEAMS.u12Gold]);

      await t.as('quinn');
      expect((await t.rpc('my_tenants')).tenants).toEqual([]);
      await t.asAnon();
      expect(await t.fails('my_tenants')).toMatch(/permission denied/);
    }));

  it('shows a parent in two clubs only the active club’s children, fees and forms', () =>
    tx(async (t) => {
      await t.as('pat');
      expect((await t.rpc('my_contexts', { p_tenant: FR })).family.map((f: any) => f.label)).toEqual(['Leo L.', 'Mia L.']);
      expect((await t.rpc('my_contexts', { p_tenant: MV })).family).toEqual([{ athlete_id: ATHLETES.nora, label: 'Nora L.', team_ids: [TEAMS.u12Gold] }]);

      const frFees = (await t.rpc('my_fees', { p_tenant: FR })).map((f: any) => f.invoice_id);
      const mvFees = (await t.rpc('my_fees', { p_tenant: MV })).map((f: any) => f.invoice_id);
      expect(frFees).toEqual([INVOICES.mia]);
      expect(mvFees).toEqual([INVOICES.nora]);

      expect((await t.rpc('my_forms', { p_tenant: MV })).map((f: any) => f.title)).toEqual(['Mesa Valley player waiver']);
      expect((await t.rpc('my_forms', { p_tenant: FR })).map((f: any) => f.title)).not.toContain('Mesa Valley player waiver');
    }));

  it('refuses a club the person does not belong to, whatever id the client sends', () =>
    tx(async (t) => {
      await t.as('olivia');
      for (const fn of ['my_contexts', 'my_fees', 'my_forms', 'staff_room']) {
        expect(await t.fails(fn, { p_tenant: FR })).toMatch(/not a member of this club/);
      }
      expect(await t.fails('my_conversations', { p_tenant: FR, p_search: null, p_archived: false })).toMatch(/not a member of this club/);
      expect(await t.fails('my_fees', { p_tenant: TEAMS.u12Blue })).toMatch(/not a member of this club/);
      expect(await t.fails('my_fees', { p_tenant: null })).toMatch(/not a member of this club/);
    }));

  it('keeps conversations in the club they belong to', () =>
    tx(async (t) => {
      await t.as('pat');
      const mvDm = await t.rpc('dm_start', { p_other: PEOPLE.olivia, p_tenant: MV });
      expect(await t.fails('dm_start', { p_other: PEOPLE.olivia, p_tenant: FR })).toMatch(/share a team/);
      const frDm = await t.rpc('dm_start', { p_other: PEOPLE.casey, p_tenant: FR });
      await t.rpc('message_post', { p_conversation: mvDm, p_body: 'Hi Olivia, Nora can carpool Saturday.' });

      const fr = (await t.rpc('my_conversations', { p_tenant: FR, p_search: null, p_archived: false })).map((c: any) => c.id);
      const mv = (await t.rpc('my_conversations', { p_tenant: MV, p_search: null, p_archived: false })).map((c: any) => c.id);
      expect(fr).toContain(frDm);
      expect(fr).not.toContain(mvDm);
      expect(mv).toContain(mvDm);
      expect(mv).not.toContain(frDm);

      await t.as('olivia');
      const olivia = (await t.rpc('my_conversations', { p_tenant: MV, p_search: null, p_archived: false })).map((c: any) => c.id);
      expect(olivia).toContain(mvDm);
      expect(olivia).not.toContain(frDm);
    }));

  it('prepares and shows staff work only inside the active club', () =>
    tx(async (t) => {
      // Casey also coaches in Mesa Valley for this test.
      await t.asAdmin();
      await t.sql(`insert into public.team_staff(team_id, person_id, role, granted_by) values ($1, $2, 'head_coach', $3)`, [TEAMS.u12Gold, PEOPLE.casey, PEOPLE.olivia]);

      await t.as('casey');
      expect(await t.rpc('staff_run_triggers', { p_tenant: FR })).toBeGreaterThan(0);
      expect(await t.rpc('staff_run_triggers', { p_tenant: FR })).toBe(0); // once an hour per club
      const frWork = (await t.rpc('staff_room', { p_tenant: FR })).work;
      expect(frWork.length).toBeGreaterThan(0);
      expect(frWork.every((w: any) => w.team_id === TEAMS.u12Blue)).toBe(true);
      expect(new Set(frWork.map((w: any) => w.kind))).toEqual(new Set(['attendance_reminder', 'practice_plan', 'announcement']));

      expect((await t.rpc('staff_room', { p_tenant: MV })).work).toEqual([]);
      expect(await t.rpc('staff_run_triggers', { p_tenant: MV })).toBeGreaterThan(0);
      const mvWork = (await t.rpc('staff_room', { p_tenant: MV })).work;
      expect(mvWork.every((w: any) => w.team_id === TEAMS.u12Gold)).toBe(true);
      expect(mvWork.map((w: any) => w.id)).not.toEqual(expect.arrayContaining(frWork.map((w: any) => w.id)));
      const reminder = frWork.find((w: any) => w.kind === 'attendance_reminder');
      expect(reminder.event_id).toBeTruthy();
    }));

  it('reminds only the active club’s families about overdue fees', () =>
    tx(async (t) => {
      await t.as('dana');
      expect(await t.fails('staff_run_triggers', { p_tenant: MV })).toMatch(/not a member of this club/);
      await t.rpc('staff_run_triggers', { p_tenant: FR });
      const fee = (await t.rpc('staff_room', { p_tenant: FR })).work.find((w: any) => w.kind === 'fee_reminder');
      expect(fee).toMatchObject({ org_id: FR, title: 'Overdue balance reminders' });
      const full = await t.rpc('prepared_work_get', { p_id: fee.id });
      expect(full.artifact.recipients.map((r: any) => r.person_id)).toEqual([PEOPLE.jordan]);
      expect(full.artifact.body).not.toMatch(/\$|60/);
    }));
});
