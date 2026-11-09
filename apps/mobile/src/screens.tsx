import { randomUUID } from 'expo-crypto';
import type { PreparedWork, StaffRoom } from '@openseason/contracts';
import { displayTitle, isEditable, type ActionStatus, type AppContext, type StaffRoleId } from '@openseason/domain';
import { space } from '@openseason/tokens';
import { useEffect, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { GATEWAY_URL, useSession } from './session';
import { ActionBadge, Badge, Button, Card, Show, T, money, useColors, useLoad, when } from './ui';

export function SignIn() {
  const { signIn } = useSession();
  const [people, setPeople] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_URL}/auth/personas`).then((r) => r.json()).then((b) => setPeople(b.data), () => setError(`Cannot reach the gateway at ${GATEWAY_URL}.`));
  }, []);
  return (
    <View style={{ gap: space[3] }}>
      <T kind="heading">Sign in to OpenSeason</T>
      <Badge tone="sandbox" text="Sandbox: synthetic people, no passwords" />
      {error && <T>{error}</T>}
      {people?.map((p) => (
        <Button key={p.id} title={p.label} accessibilityLabel={`Sign in as ${p.label}`} onPress={async () => {
          const r = await fetch(`${GATEWAY_URL}/auth/dev-sign-in`, { method: 'POST', body: JSON.stringify({ persona: p.id }) });
          const b = (await r.json()) as { data?: { token: string } };
          if (!b.data) throw new Error('Sign-in failed');
          await signIn(b.data.token);
        }} />
      ))}
    </View>
  );
}

const range = () => [new Date(Date.now() - 86400e3), new Date(Date.now() + 60 * 86400e3)] as const;

type Work = StaffRoom['work'][number];
const DONE = new Set(['saved', 'done', 'dismissed']);
const openWork = (w: Work) => !DONE.has(w.status) && !(w.action && ['succeeded', 'ended'].includes(w.action.status));

export function Home({ ctx }: { ctx: AppContext }) {
  const { client, tenant } = useSession();
  const staffed = ctx.kind === 'team' || ctx.kind === 'club';
  const [room, reloadRoom] = useLoad(() => (staffed ? client.staffRoom(tenant!.id) : Promise.resolve(null)), [client, tenant?.id, staffed]);
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <WorkScreen id={open} onBack={() => { setOpen(null); reloadRoom(); }} />;
  const r = room.state === 'ready' ? room.data : null;
  const mine = (w: Work) => openWork(w) && (ctx.kind === 'team' ? w.team_id === ctx.teamId : ctx.kind === 'club' ? w.org_id === ctx.orgId : false);
  const work = r?.entitlement.staff_enabled ? r.work.filter(mine) : [];
  if (ctx.kind === 'club') return <ClubHome orgId={ctx.orgId} work={work} onOpen={setOpen} />;
  const teamIds = ctx.kind === 'team' ? [ctx.teamId] : ctx.teamIds;
  return (
    <View style={{ gap: space[3] }}>
      {ctx.kind === 'team' && <Waiting work={work.filter((w) => !w.event_id)} onOpen={setOpen} />}
      <Schedule teamIds={teamIds} athleteId={ctx.kind === 'team' ? null : ctx.athleteId} canScore={ctx.kind === 'team' && ctx.role === 'head_coach'} rsvp={ctx.kind === 'family' || ctx.kind === 'athlete'}
        drafts={work.filter((w) => w.event_id)} onOpen={setOpen} />
      {ctx.kind === 'family' && <Fees />}
    </View>
  );
}

/** Staff drafts that wait on the person. Each opens full screen with its approval. */
function Waiting({ work, onOpen }: { work: Work[]; onOpen: (id: string) => void }) {
  if (work.length === 0) return null;
  return (
    <Card>
      <T kind="title">Waiting on you</T>
      <T kind="caption" muted>Staff drafted these. Nothing is sent until you approve it.</T>
      {work.map((w) => <DraftRow key={w.id} w={w} onOpen={onOpen} />)}
    </Card>
  );
}

function DraftRow({ w, onOpen }: { w: Work; onOpen: (id: string) => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Review ${w.title}`} onPress={() => onOpen(w.id)}
      style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: space[3], marginTop: space[2], minHeight: 44, gap: space[1] }}>
      <T kind="bodyStrong">{w.title}</T>
      {w.action ? <ActionBadge status={w.action.status} /> : <Badge tone="pending" text="Draft" />}
    </Pressable>
  );
}

function Schedule({ teamIds, athleteId, canScore, rsvp, drafts, onOpen }: { teamIds: string[]; athleteId: string | null; canScore: boolean; rsvp: boolean; drafts: Work[]; onOpen: (id: string) => void }) {
  const { client } = useSession();
  const [events, reload] = useLoad(async () => {
    const [from, to] = range();
    return (await Promise.all(teamIds.map((t) => client.teamSchedule(t, from, to)))).flat().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [client, teamIds.join()]);
  return (
    <Show value={events}>
      {(list) => (
        <View>
          <T kind="title">Schedule</T>
          {list.length === 0 && <T muted>Nothing scheduled.</T>}
          {list.map((e) => (
            <Card key={e.id}>
              <T kind="bodyStrong">{e.title}{e.opponent ? ` vs ${e.opponent}` : ''}</T>
              <T muted>{when(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</T>
              {e.score && <T>Score {e.score.home}–{e.score.away} ({e.score.status})</T>}
              {e.rsvp_summary && <T kind="caption" muted>Going {e.rsvp_summary.yes} · Maybe {e.rsvp_summary.maybe} · No {e.rsvp_summary.no} · No reply {e.rsvp_summary.no_response}</T>}
              {rsvp && e.my_rsvps.filter((r) => !athleteId || r.athlete_id === athleteId).map((r) => (
                <View key={r.athlete_id} style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
                  {(['yes', 'maybe', 'no'] as const).map((s) => (
                    <Button key={s} title={s === 'yes' ? 'Going' : s === 'no' ? 'Not going' : 'Maybe'} variant={r.status === s ? 'primary' : 'default'}
                      accessibilityLabel={`${r.athlete}: ${s}`} onPress={async () => { await client.rsvp(e.id, r.athlete_id, s); reload(); }} />
                  ))}
                </View>
              ))}
              {drafts.filter((w) => w.event_id === e.id).map((w) => <DraftRow key={w.id} w={w} onOpen={onOpen} />)}
              {canScore && e.kind === 'game' && <Scorer eventId={e.id} score={e.score} onSaved={reload} />}
            </Card>
          ))}
        </View>
      )}
    </Show>
  );
}

function Scorer({ eventId, score, onSaved }: { eventId: string; score: { home: number; away: number; period: number; version: number; status: string } | null; onSaved: () => void }) {
  const { client } = useSession();
  const [home, setHome] = useState(score?.home ?? 0);
  const [away, setAway] = useState(score?.away ?? 0);
  const save = (status: string) => client.rpc('score_update', { p_event: eventId, p_expected_version: score?.version ?? 1, p_home: home, p_away: away, p_period: score?.period ?? 1, p_clock: null, p_status: status }).then(onSaved);
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
        <Button title="Us +1" onPress={() => setHome(home + 1)} /><T kind="title">{home}–{away}</T><Button title="Them +1" onPress={() => setAway(away + 1)} />
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button title="Save live" onPress={() => save('live')} /><Button title="Final" variant="primary" onPress={() => save('final')} />
      </View>
    </View>
  );
}

function Fees() {
  const { client, tenant } = useSession();
  const [fees, reload] = useLoad(() => client.myFees(tenant!.id), [client, tenant?.id]);
  return (
    <Show value={fees}>
      {(list) => (
        <View>
          <T kind="title">Fees</T>
          {list.map((f) => (
            <Card key={f.invoice_id}>
              <T kind="bodyStrong">{f.athlete}: {f.description}</T>
              <T>{money(f.paid_cents, f.currency)} paid of {money(f.amount_cents, f.currency)}</T>
              {f.installments.map((i) => (
                <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T>#{i.seq} {money(i.amount_cents, f.currency)} · {i.due_on}</T>
                  {i.status === 'paid' ? <Badge tone="success" text="Paid" /> : i.pending ? <Badge tone="pending" text="Pending" /> : (
                    <Button title="Pay" variant="primary" accessibilityLabel={`Pay installment ${i.seq}`} onPress={async () => {
                      const r = await client.rpc<{ checkout_url?: string }>('payment_start', { p_installment: i.id, p_idempotency_key: randomUUID() });
                      // Provider-hosted checkout opens in the system browser; the app never sees card details.
                      if (r.checkout_url) await Linking.openURL(r.checkout_url);
                      reload();
                    }} />
                  )}
                </View>
              ))}
            </Card>
          ))}
        </View>
      )}
    </Show>
  );
}

function ClubHome({ orgId, work, onOpen }: { orgId: string; work: Work[]; onOpen: (id: string) => void }) {
  const { client } = useSession();
  const [fin] = useLoad(() => client.rpc<{ outstanding_cents: number; overdue_cents: number }>('org_finance_summary', { p_org: orgId }), [client, orgId]);
  const [comp] = useLoad(() => client.rpc<{ certifications: { person: string; kind: string; status: string; gap: boolean }[] }>('compliance_overview', { p_org: orgId }), [client, orgId]);
  return (
    <View style={{ gap: space[3] }}>
      <Waiting work={work} onOpen={onOpen} />
      <Show value={fin}>{(f) => <Card><T kind="title">Money</T><T>{money(f.outstanding_cents)} outstanding · {money(f.overdue_cents)} overdue</T></Card>}</Show>
      <Show value={comp}>{(c) => (
        <Card>
          <T kind="title">Certification gaps</T>
          {c.certifications.filter((x) => x.gap).map((x, i) => <T key={i}>{x.person}: {x.kind.replace('_', ' ')} ({x.status})</T>)}
          <T kind="caption" muted>Club records only. OpenSeason does not certify compliance.</T>
        </Card>
      )}</Show>
    </View>
  );
}

function WorkScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { client } = useSession();
  const [work, reload] = useLoad(() => client.preparedWork(id), [client, id]);
  return (
    <View style={{ gap: space[3] }}>
      <Button title="Back" onPress={onBack} />
      <Show value={work}>
        {(w: PreparedWork) => {
          const a = w.action;
          const art = w.artifact as { body?: string; blocks?: { title: string; minutes: number }[] };
          return (
            <View style={{ gap: space[3] }}>
              <Card>
                <T kind="title">{w.title}</T>
                {art.body && <T>{art.body}</T>}
                {art.blocks?.map((b, i) => <T key={i}>{b.minutes} min · {b.title}</T>)}
                {w.sources?.some((s) => s.changed) && <Badge tone="warning" text="Sources changed: refresh before approving" />}
                {!a && w.kind !== 'practice_plan' && w.status !== 'dismissed' && (
                  <Button title="Ready for approval" variant="primary" onPress={async () => { await client.rpc('prepared_work_propose', { p_id: w.id }); reload(); }} />
                )}
              </Card>
              {a && (
                <Card>
                  <ActionBadge status={a.status} />
                  <T kind="bodyStrong">{a.summary.effect}</T>
                  {a.summary.recipients && <T kind="caption">To: {a.summary.recipients.join(', ')}</T>}
                  <T kind="caption" muted>Approval applies to exactly version {a.revision}.</T>
                  {isEditable(a.status as ActionStatus) && a.status !== 'needs_refresh' && (
                    <Button title="Approve and send" variant="primary" onPress={async () => { await client.approve(a.id, a.revision, a.payload_hash, randomUUID()); reload(); }} />
                  )}
                  {a.status === 'needs_refresh' && <Button title="Refresh" onPress={async () => { await client.rpc('action_refresh', { p_id: a.id }); reload(); }} />}
                  {isEditable(a.status as ActionStatus) && <Button title="Reject" variant="danger" onPress={async () => { await client.reject(a.id, 'Not now'); reload(); }} />}
                  {a.status === 'failed' && <Button title="Try again" onPress={async () => { await client.rpc('action_retry', { p_id: a.id }); reload(); }} />}
                </Card>
              )}
              <Thread role={w.role_id as StaffRoleId} />
            </View>
          );
        }}
      </Show>
    </View>
  );
}

function Thread({ role }: { role: StaffRoleId }) {
  const { client } = useSession();
  const c = useColors();
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ id: string; author: string; body: string; created_at: string }[]>([]);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState('');
  const load = async (t: string) => { const p = await client.staffThread(t); setMsgs([...p.messages].reverse()); setMore(p.has_more); };
  useEffect(() => {
    client.rpc<string>('staff_thread_open', { p_role: role, p_context: {}, p_title: displayTitle(role) }).then((t) => { setThread(t); return load(t); }, () => undefined);
  }, [client, role]);
  if (!thread) return null;
  return (
    <Card>
      <T kind="title">Talk to {displayTitle(role)}</T>
      {more && <Button title="Fetch more" onPress={async () => { const p = await client.staffThread(thread, msgs[0]?.created_at); setMsgs([...[...p.messages].reverse(), ...msgs]); setMore(p.has_more); }} />}
      {msgs.map((m) => (
        <View key={m.id} style={{ backgroundColor: m.author === 'person' ? c.accentSubtle : c.surfaceRaised, borderRadius: 8, padding: space[2] }}>
          <T kind="caption" muted>{m.author === 'person' ? 'You' : displayTitle(role)} · {when(m.created_at)}</T>
          <T>{m.body}</T>
        </View>
      ))}
      <TextInput accessibilityLabel="Message to staff" value={draft} onChangeText={setDraft} multiline
        style={{ minHeight: 88, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, padding: space[2], color: c.text }} />
      <Button title="Send to staff" variant="primary" disabled={!draft.trim()} onPress={async () => { await client.rpc('staff_message_post', { p_thread: thread, p_body: draft.trim(), p_input_mode: 'typed' }); setDraft(''); await load(thread); }} />
    </Card>
  );
}

export function Messages() {
  const { client, tenant } = useSession();
  const c = useColors();
  const [convs] = useLoad(() => client.rpc<{ id: string; title: string | null; unread: boolean }[]>('my_conversations', { p_tenant: tenant!.id, p_search: null, p_archived: false }), [client, tenant?.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, reload] = useLoad(async () => (open ? client.rpc<{ id: string; sender: string; body: string; created_at: string; held: boolean }[]>('conversation_messages', { p_conversation: open, p_before: null, p_limit: 50 }) : []), [client, open]);
  const [draft, setDraft] = useState('');
  if (open) return (
    <View style={{ gap: space[2] }}>
      <Button title="All conversations" onPress={() => setOpen(null)} />
      <Show value={msgs}>{(list) => <>{list.map((m) => <Card key={m.id}><T kind="caption" muted>{m.sender} · {when(m.created_at)}</T><T>{m.body}</T>{m.held && <Badge tone="warning" text="Held for review" />}</Card>)}</>}</Show>
      <TextInput accessibilityLabel="Reply" value={draft} onChangeText={setDraft} multiline style={{ minHeight: 66, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, padding: space[2], color: c.text }} />
      <Button title="Send" variant="primary" disabled={!draft.trim()} onPress={async () => { await client.rpc('message_post', { p_conversation: open, p_body: draft.trim(), p_parent: null }); setDraft(''); reload(); }} />
    </View>
  );
  return (
    <Show value={convs}>
      {(list) => (
        <View style={{ gap: space[2] }}>
          <T kind="heading">Messages</T>
          {list.length === 0 && <T muted>No conversations yet.</T>}
          {list.map((x) => <Button key={x.id} title={`${x.title ?? 'Conversation'}${x.unread ? ' (new)' : ''}`} onPress={() => setOpen(x.id)} />)}
        </View>
      )}
    </Show>
  );
}
