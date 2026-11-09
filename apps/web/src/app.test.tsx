import { OpenSeasonClient, type Transport } from '@openseason/api-client';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SignIn } from './screens/SignIn';
import { SessionProvider } from './session';

afterEach(cleanup);

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEAM = id(501);
const WORK = id(900);
const ACTION = id(901);
const NOW = '2026-11-07T18:00:00Z';

const action = {
  id: ACTION, kind: 'send_message', status: 'in_review', status_reason: null, revision: 3, payload_hash: 'hash-v3',
  summary: { effect: 'Send "This week" to 4 people in U12 Blue', title: 'This week', body: 'Game Thursday at 5', recipients: ['Pat Parent', 'Jordan Multi'] },
  requested_via: 'person', approved_by: null, rejected_reason: null, outcome: null, prepared_work_id: WORK, updated_at: NOW, attempts: [],
};

const FR = id(401);
const MV = id(402);
const GAME = id(710);
const REMINDER = id(902);
const none = { clubs: [], teams: [], family: [], athlete: [], fan: [] };

function fixtures(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    // Casey coaches U12 Blue at Front Range and is a parent at Mesa Valley: two roles, two clubs.
    my_tenants: {
      person: { id: id(102), display_name: 'Casey Coach' },
      tenants: [
        { id: FR, kind: 'club', name: 'Front Range FC', roles: ['coach'], contexts: { ...none, teams: [{ team_id: TEAM, org_id: FR, label: 'U12 Blue', role: 'head_coach' }] } },
        { id: MV, kind: 'club', name: 'Mesa Valley SC', roles: ['family'], contexts: { ...none, family: [{ athlete_id: id(306), label: 'Nora L.', team_ids: [id(503)] }] } },
      ],
    },
    team_schedule: [{
      id: GAME, team_id: TEAM, kind: 'game', title: 'Game', opponent: 'Rockets', starts_at: '2026-11-12T23:00:00Z', ends_at: '2026-11-13T00:30:00Z',
      status: 'scheduled', version: 1, location: 'Field 3', score: null, my_rsvps: [], rsvp_summary: { yes: 5, no: 1, maybe: 0, no_response: 3 },
    }],
    team_roster: [],
    my_forms: [],
    my_fees: [],
    staff_room: {
      entitlement: { plan: 'staff', status: 'active', current_period_end: null, staff_enabled: true }, titles: {},
      work: [
        { id: WORK, kind: 'announcement', role_id: 'admin', title: 'This week for U12 Blue', summary: 'Team announcement', status: 'proposed', stale: false, team_id: TEAM, org_id: null, event_id: null, thread_id: null, updated_at: NOW, action: { id: ACTION, status: 'in_review', revision: 3 } },
        { id: REMINDER, kind: 'attendance_reminder', role_id: 'admin', title: 'RSVP reminder: Game vs Rockets', summary: null, status: 'proposed', stale: false, team_id: TEAM, org_id: null, event_id: GAME, thread_id: null, updated_at: NOW, action: { id: id(903), status: 'in_review', revision: 1 } },
      ],
      actions: [],
    },
    prepared_work_get: {
      id: WORK, kind: 'announcement', role_id: 'admin', title: 'This week for U12 Blue', summary: null, artifact: { title: 'This week', body: 'Game Thursday at 5', recipients: [{ name: 'Pat Parent', person_id: id(104) }] },
      status: 'proposed', revision: 3, team_id: TEAM, org_id: null, thread_id: null, created_via: 'agent', updated_at: NOW, sources: [], action,
    },
    staff_thread_open: id(950),
    staff_thread_messages: { messages: [], has_more: false },
    action_approve: { status: 'queued' },
    ...over,
  };
}

function fakeTransport(data: Record<string, unknown>, fail: Record<string, Error> = {}) {
  const call = vi.fn(async (fn: string, _args: Record<string, unknown>) => {
    if (fail[fn]) throw fail[fn];
    if (!(fn in data)) throw new Error(`no fixture for ${fn}`);
    return data[fn];
  });
  return { call } satisfies Transport;
}

function renderApp(t: Transport) {
  return render(<SessionProvider client={new OpenSeasonClient(t)}><App /></SessionProvider>);
}

/** The coach's home lists staff drafts waiting on them; Review opens one in place. */
async function reviewWaitingDraft() {
  const waiting = await screen.findByRole('region', { name: 'Waiting on you' });
  await within(waiting).findByText('This week for U12 Blue');
  const row = within(waiting).getByText('This week for U12 Blue').closest('li')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Review' }));
  await screen.findByText('What approving does');
}

async function noA11yViolations(node: Element) {
  // Colour contrast is verified on the tokens themselves (packages/tokens); jsdom cannot compute layout colours.
  const r = await axe.run(node, { rules: { 'color-contrast': { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

describe('staff work inside each task', () => {
  it('shows what approving will do and approves exactly the version on screen', async () => {
    const t = fakeTransport(fixtures());
    renderApp(t);
    await reviewWaitingDraft();
    expect(screen.getByText('Send "This week" to 4 people in U12 Blue')).toBeTruthy();
    expect(screen.getByText(/To: Pat Parent, Jordan Multi/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    await screen.findByText(/Approved\. It will be sent shortly/);
    const call = t.call.mock.calls.find(([fn]) => fn === 'action_approve')!;
    expect(call[1]).toMatchObject({ p_id: ACTION, p_expected_revision: 3, p_expected_hash: 'hash-v3' });
    expect(typeof call[1].p_approval_key).toBe('string');
  });

  it('explains a stale approval in plain language instead of pretending it worked', async () => {
    const { ApiError } = await import('@openseason/api-client');
    const t = fakeTransport(fixtures(), { action_approve: ApiError.fromCode('40001', 'this action changed; review it again') });
    renderApp(t);
    await reviewWaitingDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/This changed since you opened it/);
    expect(screen.queryByText(/Approved\. It will be sent shortly/)).toBeNull();
  });

  it('puts the RSVP reminder on the game it is for, not in a separate section', async () => {
    renderApp(fakeTransport(fixtures()));
    expect(screen.queryByRole('button', { name: 'Staff Room' })).toBeNull();
    const game = (await screen.findByText(/Game vs Rockets/, { selector: '.event-title' })).closest('li')!;
    expect(within(game as HTMLElement).getByText('RSVP reminder: Game vs Rockets')).toBeTruthy();
    expect(within(game as HTMLElement).getByText(/Drafted by/)).toBeTruthy();
  });

  it('without the Staff plan, explains it once on Home and leaves every task as it was', async () => {
    const t = fakeTransport(fixtures({ staff_room: { ...(fixtures().staff_room as object), entitlement: { plan: 'diy', status: 'none', current_period_end: null, staff_enabled: false } } }));
    renderApp(t);
    await screen.findByText(/Plan purchase is not connected/);
    await screen.findByText(/Game vs Rockets/, { selector: '.event-title' });
    expect(screen.queryByText('RSVP reminder: Game vs Rockets')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft it' })).toBeNull();
  });

  it('has no detectable accessibility violations', async () => {
    const t = fakeTransport(fixtures());
    const { container } = renderApp(t);
    await reviewWaitingDraft();
    await waitFor(() => expect(t.call.mock.calls.some(([fn]) => fn === 'staff_thread_messages')).toBe(true));
    await noA11yViolations(container);
  });
});

describe('roles and clubs', () => {
  it('switches role and club like the prototype, and reads only the chosen club', async () => {
    const t = fakeTransport(fixtures());
    renderApp(t);
    const role = await screen.findByLabelText('Role') as HTMLSelectElement;
    expect(Array.from(role.options).map((o) => o.textContent)).toEqual(['Coach', 'Parent']);
    expect((screen.getByLabelText('Team') as HTMLSelectElement).value).toContain(FR);
    fireEvent.change(role, { target: { value: 'family' } });
    const child = await screen.findByLabelText('Child') as HTMLSelectElement;
    expect(Array.from(child.options).map((o) => o.textContent)).toEqual(['Nora L. · Mesa Valley SC']);
    await waitFor(() => expect(t.call.mock.calls.some(([fn, a]) => fn === 'my_fees' && a.p_tenant === MV)).toBe(true));
    expect(t.call.mock.calls.filter(([fn]) => fn === 'my_fees').every(([, a]) => a.p_tenant === MV)).toBe(true);
    await waitFor(() => expect(t.call.mock.calls.some(([fn, a]) => fn === 'staff_room' && a.p_tenant === MV)).toBe(true));
  });
});

describe('sign-in', () => {
  it('lists synthetic people only and is accessible', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'pat', label: 'Pat Parent (guardian of Mia and Leo)' }] })));
    const { container } = render(<SessionProvider><SignIn fetchImpl={f as unknown as typeof fetch} /></SessionProvider>);
    await screen.findByRole('button', { name: /Sign in as Pat Parent/ });
    expect(screen.getByText(/synthetic people/)).toBeTruthy();
    await noA11yViolations(container);
  });
});
