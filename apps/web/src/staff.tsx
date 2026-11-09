// Staff work lives on the task it belongs to. Staff prepare drafts in place
// (an overdue-fee reminder on Payments, an RSVP reminder on the game it is for,
// a practice plan on the practice), the person reviews and edits them there, and
// nothing reaches anyone until the person approves the exact version shown.
import { idempotencyKey } from '@openseason/api-client';
import type { PendingAction, PreparedWork, StaffRoom } from '@openseason/contracts';
import { displayTitle, isEditable, type ActionStatus, type PreparedWorkKind, type StaffRoleId } from '@openseason/domain';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { useSession } from './session';
import { ActionBadge, ActionButton, Badge, describeError, Notice, Show, useLoad, when } from './ui';

type Work = StaffRoom['work'][number];
type Titles = Partial<Record<StaffRoleId, string>>;
interface Staff { room: StaffRoom | null; reload: () => void; titles: Titles; tenantId: string }

const StaffCtx = createContext<Staff | null>(null);

/** Loads the person's staff work inside one club, and keeps it fresh while the page is open. */
export function StaffProvider({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { client } = useSession();
  const [room, reload] = useLoad(() => client.staffRoom(tenantId), [client, tenantId]);
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);
  const data = room.state === 'ready' ? room.data : null;
  return <StaffCtx.Provider value={{ room: data, reload, titles: (data?.titles ?? {}) as Titles, tenantId }}>{children}</StaffCtx.Provider>;
}

function useStaff(): Staff | null { return useContext(StaffCtx); }

const DONE_WORK = new Set(['saved', 'done', 'dismissed']);
const DONE_ACTION = new Set(['succeeded', 'ended']);
const NEEDS_YOU = new Set(['proposed', 'in_review', 'needs_refresh', 'rejected', 'failed']);

const isOpen = (w: Work) => !DONE_WORK.has(w.status) && !(w.action && DONE_ACTION.has(w.action.status));
const needsYou = (w: Work) => isOpen(w) && (!w.action || NEEDS_YOU.has(w.action.status));

/** Where each kind of draft lives, so Home can say where to find it. */
export const TASK_OF: Record<string, string> = {
  fee_reminder: 'Payments', certification_nudge: 'Compliance', attendance_reminder: 'Schedule',
  practice_plan: 'Schedule', announcement: 'Messages', player_feedback: 'Roster', rotation: 'Schedule',
};

export interface Prepare { kind: PreparedWorkKind; label: string; target: Record<string, unknown> }

/**
 * Staff drafts for one task, shown inside that task. With no draft yet, a
 * person on the staff plan can ask staff to draft one here. People without
 * the plan see nothing extra: the task itself works the same.
 */
export function StaffDrafts({ match, prepare, compact }: { match: (w: Work) => boolean; prepare?: Prepare; compact?: boolean }) {
  const staff = useStaff();
  const { client } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  if (!staff?.room || !staff.room.entitlement.staff_enabled) return null;
  const items = staff.room.work.filter((w) => isOpen(w) && match(w));
  if (items.length === 0 && !prepare) return null;
  return (
    <div className={`staff-drafts${compact ? ' compact' : ''}`}>
      {items.map((w) => (
        <div key={w.id} className="staff-card">
          <div className="staff-card-row">
            <span className="staff-mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
            <span className="staff-card-text">
              <strong>{w.title}</strong>
              <span className="small muted">Drafted by {displayTitle(w.role_id as StaffRoleId, staff.titles)}{w.stale ? ' · sources changed' : ''}</span>
            </span>
            {w.action ? <ActionBadge status={w.action.status} /> : <Badge tone="pending">Draft</Badge>}
            <button type="button" className="btn" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)}>
              {open === w.id ? 'Close' : 'Review'}
            </button>
          </div>
          {open === w.id && <div className="staff-card-body"><WorkDetail id={w.id} titles={staff.titles} onChanged={staff.reload} /></div>}
        </div>
      ))}
      {items.length === 0 && prepare && (
        <div className="staff-offer">
          <span className="staff-mark" aria-hidden="true"><Icon name="spark" size={16} /></span>
          <span className="small muted grow">Staff can draft {prepare.label} for you to review.</span>
          <ActionButton variant="quiet" onRun={async () => {
            const id = await client.rpc<string>('staff_prepare', { p_kind: prepare.kind, p_target: prepare.target, p_thread: null });
            staff.reload();
            setOpen(id);
          }}>Draft it</ActionButton>
        </div>
      )}
    </div>
  );
}

/** Home: every staff draft in this club that waits on the person, with batch approval. */
export function WaitingOnYou() {
  const staff = useStaff();
  const { client } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const [batch, setBatch] = useState<Record<string, PendingAction>>({});
  const [result, setResult] = useState<string | null>(null);
  if (!staff?.room) return null;
  const r = staff.room;
  if (!r.entitlement.staff_enabled) {
    return (
      <section className="card staff-plan" aria-labelledby="staff-plan">
        <h2 id="staff-plan">Staff can do the routine work for you</h2>
        <p className="muted">On the Staff plan, staff draft fee reminders, RSVP reminders, practice plans and announcements inside each task, and you approve them. You are on the {r.entitlement.plan === 'diy' || r.entitlement.plan === 'none' ? 'free tools' : r.entitlement.plan} plan, and every tool still works without it.</p>
        <Notice tone="info">Plan purchase is not connected in this environment, so there is nothing to buy here.</Notice>
      </section>
    );
  }
  const waiting = r.work.filter(needsYou);
  return (
    <section className="card flush" aria-labelledby="waiting">
      <div className="card-head">
        <h2 id="waiting">Waiting on you</h2>
        <span className="muted small">{waiting.length === 0 ? 'Nothing right now' : `${waiting.length} draft${waiting.length === 1 ? '' : 's'} from staff`}</span>
      </div>
      {result && <div className="card-pad"><Notice tone="info">{result}</Notice></div>}
      {waiting.length === 0 ? <p className="card-pad muted small">Staff check for work on their own and put drafts on the task they belong to. Nothing is sent until you approve it.</p> : (
        <ul className="rows waiting-list">
          {waiting.map((w) => (
            <li key={w.id} className="waiting-item">
              <div className="row-item">
                {w.action && isEditable(w.action.status as ActionStatus) ? (
                  <input type="checkbox" className="work-check" aria-label={`Select ${w.title} to approve together`} checked={Boolean(batch[w.action.id])}
                    onChange={async (e) => {
                      const id = w.action!.id;
                      if (!e.target.checked) { const { [id]: _drop, ...rest } = batch; setBatch(rest); return; }
                      const a = await client.rpc<PendingAction>('action_get', { p_id: id });
                      setBatch((b) => ({ ...b, [id]: a }));
                    }} />
                ) : <span className="work-check" aria-hidden="true" />}
                <div className="grow">
                  <strong>{w.title}</strong>
                  <span className="small muted"> · {TASK_OF[w.kind] ?? 'Task'} · {when(w.updated_at)}</span>
                </div>
                {w.action ? <ActionBadge status={w.action.status} /> : <Badge tone="pending">Draft</Badge>}
                <button type="button" className="btn" aria-expanded={open === w.id} onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? 'Close' : 'Review'}</button>
              </div>
              {open === w.id && <div className="staff-card-body"><WorkDetail id={w.id} titles={staff.titles} onChanged={staff.reload} /></div>}
            </li>
          ))}
        </ul>
      )}
      {Object.keys(batch).length > 0 && (
        <div className="batch card-pad" aria-live="polite">
          <h3>Approve {Object.keys(batch).length} together</h3>
          <ul className="plain">{Object.values(batch).map((a) => <li key={a.id}>{a.summary.effect} <span className="small muted">(version {a.revision})</span></li>)}</ul>
          <div className="row">
            <ActionButton variant="primary" onRun={async () => {
              const items = Object.values(batch).map((a) => ({ id: a.id, revision: a.revision, hash: a.payload_hash }));
              const res = await client.approveBatch(items, idempotencyKey());
              const failed = res.results.filter((x) => !x.ok);
              setResult(failed.length === 0 ? `Approved ${res.results.length}.` : `Approved ${res.results.length - failed.length}. ${failed.length} need attention: ${failed.map((f) => f.error).join('; ')}`);
              setBatch({});
              staff.reload();
            }}>Approve these exactly as shown</ActionButton>
            <button type="button" className="btn quiet" onClick={() => setBatch({})}>Clear</button>
          </div>
        </div>
      )}
    </section>
  );
}

type Block = { title: string; drill: string; minutes: number; notes: string };
type Recipient = { name: string; person_id: string };

export function WorkDetail({ id, titles, onChanged }: { id: string; titles: Partial<Record<StaffRoleId, string>>; onChanged: () => void }) {
  const { client } = useSession();
  const [work, reload] = useLoad(() => client.preparedWork(id), [client, id]);
  const refresh = () => { reload(); onChanged(); };
  return (
    <Show value={work}>
      {(w) => (
        <div className="stack">
          <div className="card">
            <div className="card-row">
              <h2 className="grow">{w.title}</h2>
              {w.action ? <ActionBadge status={w.action.status} /> : <Badge tone="pending">{w.status.replace('_', ' ')}</Badge>}
            </div>
            <p className="small muted meta-line">Prepared by {displayTitle(w.role_id as StaffRoleId, titles)} {w.created_via === 'agent' ? '(staff)' : '(you asked)'} · version {w.revision}</p>
            {w.sources?.some((s) => s.changed) && (
              <Notice tone="warning">Something this was built from has changed: {w.sources.filter((s) => s.changed).map((s) => s.label).join(', ')}. Refresh before approving.</Notice>
            )}
            {w.kind === 'practice_plan' ? <PlanEditor work={w} onSaved={refresh} /> : <MessageEditor work={w} onSaved={refresh} />}
          </div>
          {w.action && <ActionPanel action={w.action} onChanged={refresh} />}
          <details className="card disclosure">
            <summary>Talk to {displayTitle(w.role_id as StaffRoleId, titles)}</summary>
            <StaffThread role={w.role_id as StaffRoleId} titles={titles} />
          </details>
        </div>
      )}
    </Show>
  );
}

function PlanEditor({ work, onSaved }: { work: PreparedWork; onSaved: () => void }) {
  const { client } = useSession();
  const art = work.artifact as { blocks: Block[]; focus?: string };
  const [blocks, setBlocks] = useState<Block[]>(art.blocks);
  const total = blocks.reduce((n, b) => n + (Number(b.minutes) || 0), 0);
  const saved = work.status === 'saved';
  const set = (i: number, patch: Partial<Block>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="stack">
      {art.focus && <p><strong>Focus:</strong> {art.focus}</p>}
      <p className="muted">{blocks.length} blocks, {total} minutes</p>
      <ol className="blocks">
        {blocks.map((b, i) => (
          <li key={i} className="block">
            <div className="block-grid">
              <div><label htmlFor={`bt-${i}`}>Block {i + 1}</label><input id={`bt-${i}`} value={b.title} disabled={saved} onChange={(e) => set(i, { title: e.target.value })} /></div>
              <div><label htmlFor={`bm-${i}`}>Minutes</label><input id={`bm-${i}`} type="number" min={1} max={120} value={b.minutes} disabled={saved} onChange={(e) => set(i, { minutes: Number(e.target.value) })} /></div>
            </div>
            <label htmlFor={`bd-${i}`} className="sub-label">Drill</label>
            <input id={`bd-${i}`} value={b.drill} disabled={saved} onChange={(e) => set(i, { drill: e.target.value })} />
          </li>
        ))}
      </ol>
      {saved ? <Notice tone="success">Saved to your practice plans.</Notice> : (
        <div className="row">
          <ActionButton onRun={async () => { await client.rpc('prepared_work_update', { p_id: work.id, p_expected_revision: work.revision, p_artifact: { ...work.artifact, blocks } }); onSaved(); }}>Save edits</ActionButton>
          <ActionButton variant="primary" onRun={async () => {
            const plan = await client.rpc<{ id: string }>('practice_plan_save', { p_plan: { ...work.artifact, blocks, source_prepared_work_id: work.id } });
            await client.rpc('prepared_work_mark_saved', { p_id: work.id, p_plan: plan.id });
            onSaved();
          }}>Save to practice plans</ActionButton>
          <ActionButton variant="quiet" onRun={async () => { await client.rpc('prepared_work_dismiss', { p_id: work.id }); onSaved(); }}>Dismiss</ActionButton>
        </div>
      )}
      <p className="small muted">Saving a plan only stores it for your team. It sends nothing.</p>
    </div>
  );
}

function MessageEditor({ work, onSaved }: { work: PreparedWork; onSaved: () => void }) {
  const { client } = useSession();
  const art = work.artifact as { title?: string; body?: string; recipients?: Recipient[] };
  const [title, setTitle] = useState(art.title ?? '');
  const [body, setBody] = useState(art.body ?? '');
  const [recipients, setRecipients] = useState<Recipient[]>(art.recipients ?? []);
  const locked = Boolean(work.action && !isEditable(work.action.status as ActionStatus));
  return (
    <div className="stack">
      <div className="field"><label htmlFor="m-title">Title</label><input id="m-title" value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="m-body">Message</label><textarea id="m-body" value={body} disabled={locked} onChange={(e) => setBody(e.target.value)} /></div>
      {art.recipients && (
        <fieldset className="bare">
          <legend><strong>Goes to {recipients.length} {recipients.length === 1 ? 'person' : 'people'}</strong> <span className="small muted">(you can remove people, not add them)</span></legend>
          <ul className="chips recipients">
            {recipients.map((p) => (
              <li key={p.person_id} className="recipient">
                <span>{p.name}</span>
                {!locked && <button type="button" className="recipient-x" aria-label={`Remove ${p.name}`} onClick={() => setRecipients(recipients.filter((x) => x.person_id !== p.person_id))}>×</button>}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {!locked && (
        <div className="row">
          <ActionButton onRun={async () => {
            await client.rpc('prepared_work_update', { p_id: work.id, p_expected_revision: work.revision, p_artifact: { ...work.artifact, title, body, ...(art.recipients ? { recipients } : {}) } });
            onSaved();
          }}>Save edits</ActionButton>
          {!work.action && (
            <ActionButton variant="primary" onRun={async () => { await client.rpc('prepared_work_propose', { p_id: work.id }); onSaved(); }}>Ready for approval</ActionButton>
          )}
          <ActionButton variant="quiet" onRun={async () => { await client.rpc('prepared_work_dismiss', { p_id: work.id }); onSaved(); }}>Dismiss</ActionButton>
        </div>
      )}
      <p className="small muted">Edits to the message change the version you approve. Save edits before approving.</p>
    </div>
  );
}

function ActionPanel({ action, onChanged }: { action: PendingAction; onChanged: () => void }) {
  const { client } = useSession();
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const s = action.status as ActionStatus;
  return (
    <div className="card approve" aria-labelledby="pa">
      <div className="card-row"><h2 id="pa" className="grow">What approving does</h2><ActionBadge status={s} /></div>
      <p className="effect">{action.summary.effect}</p>
      {action.summary.recipients && <p className="small">To: {action.summary.recipients.join(', ')}</p>}
      {action.summary.body && <p className="preview">{action.summary.body}</p>}
      <p className="small muted">Version {action.revision}. Approval applies to exactly this version; if anything changes you will be asked again.</p>
      {action.status_reason && <Notice tone="warning">{action.status_reason}</Notice>}
      {action.rejected_reason && <p className="small">Rejected: {action.rejected_reason}</p>}
      {result && <Notice tone="success">{result}</Notice>}
      <div className="row">
        {(s === 'proposed' || s === 'in_review') && (
          <ActionButton variant="primary" onRun={async () => {
            await client.approve(action.id, action.revision, action.payload_hash, idempotencyKey());
            setResult('Approved. It will be sent shortly; this page updates when it is done.');
            onChanged();
          }}>Approve and send</ActionButton>
        )}
        {s === 'needs_refresh' && <ActionButton variant="primary" onRun={async () => { await client.rpc('action_refresh', { p_id: action.id }); onChanged(); }}>Refresh</ActionButton>}
        {s === 'failed' && <ActionButton onRun={async () => { await client.rpc('action_retry', { p_id: action.id }); onChanged(); }}>Try again</ActionButton>}
        {s === 'rejected' && <ActionButton onRun={async () => { await client.rpc('action_end', { p_id: action.id }); onChanged(); }}>End</ActionButton>}
      </div>
      {(s === 'proposed' || s === 'in_review' || s === 'needs_refresh') && (
        <div className="reject-row">
          <div className="grow"><label htmlFor="rej" className="sub-label">Reason for rejecting (optional)</label><input id="rej" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <ActionButton variant="danger" onRun={async () => { await client.reject(action.id, reason || 'Not now'); onChanged(); }}>Reject</ActionButton>
        </div>
      )}
      {action.attempts.length > 0 && (
        <details className="disclosure quiet"><summary>History</summary><ul>{action.attempts.map((a) => <li key={a.attempt}>{when(a.at)}: {a.outcome}{a.detail ? ` (${a.detail})` : ''}</li>)}</ul></details>
      )}
      {s === 'uncertain' && <Notice tone="warning">The provider did not confirm the result. OpenSeason will reconcile it; do not retry by hand.</Notice>}
    </div>
  );
}

type ThreadMsg = { id: string; author: 'person' | 'staff' | 'system'; body: string; status: string; created_at: string };

function StaffThread({ role, titles }: { role: StaffRoleId; titles: Partial<Record<StaffRoleId, string>> }) {
  const { client } = useSession();
  const [thread, setThread] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ThreadMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(t: string) {
    const page = await client.staffThread(t);
    setMsgs([...page.messages].reverse() as ThreadMsg[]);
    setHasMore(page.has_more);
  }
  useEffect(() => {
    let live = true;
    client.rpc<string>('staff_thread_open', { p_role: role, p_context: {}, p_title: displayTitle(role, titles) })
      .then((t) => { if (live) { setThread(t); return load(t); } }, (e) => setError(describeError(e)));
    return () => { live = false; };
  }, [client, role]);

  return (
    <div className="staff-thread">
      {error && <Notice tone="danger">{error}</Notice>}
      {hasMore && thread && (
        <ActionButton variant="quiet" onRun={async () => {
          const oldest = msgs[0];
          const page = await client.staffThread(thread, oldest?.created_at);
          setMsgs([...([...page.messages].reverse() as ThreadMsg[]), ...msgs]);
          setHasMore(page.has_more);
        }}>Fetch more</ActionButton>
      )}
      <div className="thread" aria-live="polite">
        {msgs.length === 0 && <p className="muted small">No messages yet. Ask for changes in your own words.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.author}`}>
            <div className="msg-meta">{m.author === 'person' ? 'You' : m.author === 'staff' ? displayTitle(role, titles) : 'OpenSeason'} · {when(m.created_at)}{m.status !== 'complete' ? ` · ${m.status}` : ''}</div>
            {m.body}
          </div>
        ))}
      </div>
      {thread && (
        <form onSubmit={(e) => e.preventDefault()} className="stack">
          <label htmlFor="staff-draft" className="sub-label">Message to {displayTitle(role, titles)}</label>
          <textarea id="staff-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row">
            <ActionButton variant="primary" disabled={!draft.trim()} onRun={async () => {
              await client.rpc('staff_message_post', { p_thread: thread, p_body: draft.trim(), p_input_mode: 'typed' });
              setDraft('');
              await load(thread);
            }}>Send to staff</ActionButton>
            <ActionButton variant="quiet" onRun={() => load(thread)}>Check for replies</ActionButton>
          </div>
        </form>
      )}
    </div>
  );
}
