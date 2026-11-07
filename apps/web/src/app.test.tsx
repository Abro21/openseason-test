import { OpenSeasonClient, type Transport } from '@openseason/api-client';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function fixtures(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    my_contexts: { person: { id: id(102), display_name: 'Casey Coach' }, clubs: [], teams: [{ team_id: TEAM, org_id: id(401), label: 'U12 Blue', role: 'head_coach' }], family: [], athlete: [], fan: [] },
    team_schedule: [],
    team_roster: [],
    staff_room: {
      entitlement: { plan: 'staff', status: 'active', current_period_end: null, staff_enabled: true }, titles: {},
      work: [{ id: WORK, kind: 'announcement', role_id: 'admin', title: 'This week for U12 Blue', summary: 'Team announcement', status: 'proposed', stale: false, team_id: TEAM, org_id: null, thread_id: null, updated_at: NOW, action: { id: ACTION, status: 'in_review', revision: 3 } }],
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

async function openStaffRoomItem() {
  fireEvent.click(await screen.findByRole('button', { name: 'Staff Room' }));
  fireEvent.click(await screen.findByRole('button', { name: /This week for U12 Blue/ }));
  await screen.findByText('What approving does');
}

async function noA11yViolations(node: Element) {
  // Colour contrast is verified on the tokens themselves (packages/tokens); jsdom cannot compute layout colours.
  const r = await axe.run(node, { rules: { 'color-contrast': { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

describe('Staff Room', () => {
  it('shows what approving will do and approves exactly the version on screen', async () => {
    const t = fakeTransport(fixtures());
    renderApp(t);
    await openStaffRoomItem();
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
    await openStaffRoomItem();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/This changed since you opened it/);
    expect(screen.queryByText(/Approved\. It will be sent shortly/)).toBeNull();
  });

  it('without the Staff plan, explains it and offers nothing to buy or prepare', async () => {
    const t = fakeTransport(fixtures({ staff_room: { ...(fixtures().staff_room as object), entitlement: { plan: 'diy', status: 'none', current_period_end: null, staff_enabled: false }, work: [] } }));
    renderApp(t);
    fireEvent.click(await screen.findByRole('button', { name: 'Staff Room' }));
    await screen.findByText(/Plan purchase is not connected/);
    expect(screen.queryByText('Ask staff to prepare')).toBeNull();
  });

  it('has no detectable accessibility violations', async () => {
    const t = fakeTransport(fixtures());
    const { container } = renderApp(t);
    await openStaffRoomItem();
    await waitFor(() => expect(t.call.mock.calls.some(([fn]) => fn === 'staff_thread_messages')).toBe(true));
    await noA11yViolations(container);
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
