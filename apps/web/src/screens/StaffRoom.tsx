// The Staff Room: staff prepare work, the person reviews and edits it, and
// nothing reaches anyone until the person approves the exact version shown.
import { idempotencyKey } from '@openseason/api-client';
import type { PendingAction, PreparedWork } from '@openseason/contracts';
import { displayTitle, isEditable, type ActionStatus, type AppContext, type PreparedWorkKind, type StaffRoleId } from '@openseason/domain';
import { useEffect, useState } from 'react';
import { useSession } from '../session';
import { Icon } from '../icons';
import { ActionBadge, ActionButton, Badge, describeError, Empty, Notice, PageHeader, Show, useLoad, when } from '../ui';

type Prepare = { kind: PreparedWorkKind; label: string; target: Record<string, unknown> };

function prepareOptions(ctx: AppContext, nextGame: string | null): Prepare[] {
  if (ctx.kind === 'team') {
    const out: Prepare[] = [
      { kind: 'practice_plan', label: 'Practice plan', target: { team_id: ctx.teamId } },
      { kind: 'announcement', label: 'Week-ahead announcement', target: { team_id: ctx.teamId } },
    ];
    if (nextGame) out.push({ kind: 'attendance_reminder', label: 'RSVP reminder for next game', target: { event_id: nextGame } });
    return out;
  }
  if (ctx.kind === 'club') {
    return [
      { kind: 'fee_reminder', label: 'Overdue fee reminders', target: { org_id: ctx.orgId } },
      { kind: 'certification_nudge', label: 'Certification nudges', target: { org_id: ctx.orgId } },
    ];
  }
  return [];
}

export function StaffRoom({ ctx }: { ctx: AppContext }) {
  const { client } = useSession();
  const [room, reload] = useLoad(() => client.staffRoom(), [client]);
  const [selected, setSelected] = useState<string | null>(null);
  const [batch, setBatch] = useState<Record<string, PendingAction>>({});
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [nextGame, setNextGame] = useState<string | null>(null);

  useEffect(() => {
    if (ctx.kind !== 'team') return;
    client.teamSchedule(ctx.teamId, new Date(), new Date(Date.now() + 30 * 86400e3))
      .then((ev) => setNextGame(ev.find((e) => e.kind === 'game')?.id ?? null), () => setNextGame(null));
  }, [client, ctx]);

  return (
    <Show value={room}>
      {(r) => {
        if (!r.entitlement.staff_enabled) return <NoStaff plan={r.entitlement.plan} />;
        const titles = r.titles as Partial<Record<StaffRoleId, string>>;
        const options = prepareOptions(ctx, nextGame);
        return (
          <>
            <PageHeader title="Staff Room" subtitle="Staff prepare. You review, edit and approve. Nothing is sent without your approval."
              actions={(
                <ActionButton onRun={async () => { const n = await client.rpc<number>('staff_run_triggers'); setBatchResult(n > 0 ? `Staff prepared ${n} new item${n === 1 ? '' : 's'}.` : 'Nothing new for staff to prepare right now.'); reload(); }}>
                  Check for new work
                </ActionButton>
              )} />
            {options.length > 0 && (
              <div className="prepare-bar">
                <h2 className="prepare-label">Ask staff to prepare</h2>
                <div className="chips">
                  {options.map((o) => (
                    <ActionButton key={o.kind} className="chip-btn" onRun={async () => {
                      const id = await client.rpc<string>('staff_prepare', { p_kind: o.kind, p_target: o.target, p_thread: null });
                      reload();
                      setSelected(id);
                    }}><Icon name="plus" size={16} /> {o.label}</ActionButton>
                  ))}
                </div>
              </div>
            )}
            {batchResult && <Notice tone="info">{batchResult}</Notice>}
            {Object.keys(batch).length > 0 && (
              <div className="card batch" aria-live="polite">
                <h2>Approve {Object.keys(batch).length} together</h2>
                <ul className="plain">{Object.values(batch).map((a) => <li key={a.id}>{a.summary.effect} <span className="small muted">(version {a.revision})</span></li>)}</ul>
                <div className="row">
                  <ActionButton variant="primary" onRun={async () => {
                    const items = Object.values(batch).map((a) => ({ id: a.id, revision: a.revision, hash: a.payload_hash }));
                    const res = await client.approveBatch(items, idempotencyKey());
                    const failed = res.results.filter((x) => !x.ok);
                    setBatchResult(failed.length === 0 ? `Approved ${res.results.length}.` : `Approved ${res.results.length - failed.length}. ${failed.length} need attention: ${failed.map((f) => f.error).join('; ')}`);
                    setBatch({});
                    reload();
                  }}>Approve these exactly as shown</ActionButton>
                  <button type="button" className="btn quiet" onClick={() => setBatch({})}>Clear</button>
                </div>
              </div>
            )}
            <div className="desk" data-open={selected ? 'true' : undefined}>
              <section className="desk-list" aria-labelledby="desk-list">
                <h2 id="desk-list" className="list-heading">Prepared work</h2>
                {r.work.length === 0 ? <div className="card"><Empty icon="spark" title="No prepared work yet">Ask staff to prepare something, or check for new work.</Empty></div> : (
                  <ul className="work-list" aria-label="Prepared work">
                    {r.work.map((w) => (
                      <li key={w.id} className="work-row">
                        {w.action && isEditable(w.action.status as ActionStatus) && (
                          <input type="checkbox" className="work-check" aria-label={`Select ${w.title} for batch approval`} checked={Boolean(batch[w.action.id])}
                            onChange={async (e) => {
                              const id = w.action!.id;
                              if (!e.target.checked) { const { [id]: _drop, ...rest } = batch; setBatch(rest); return; }
                              const a = await client.rpc<PendingAction>('action_get', { p_id: id });
                              setBatch((b) => ({ ...b, [id]: a }));
                            }} />
                        )}
                        <button type="button" className="work-item" aria-current={selected === w.id} onClick={() => setSelected(w.id)}>
                          <span className="work-text">
                            <span className="work-title">
                              <strong>{w.title}</strong>
                              {w.action ? <ActionBadge status={w.action.status} /> : <Badge tone="pending">{w.status.replace('_', ' ')}</Badge>}
                            </span>
                            <span className="small muted">{displayTitle(w.role_id as StaffRoleId, titles)} · {when(w.updated_at)}</span>
                            {w.stale && <span><Badge tone="warning">Sources changed</Badge></span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="desk-detail" aria-label="Selected work">
                {selected ? (
                  <>
                    <button type="button" className="back-btn" onClick={() => setSelected(null)}><Icon name="back" size={18} /> All prepared work</button>
                    <WorkDetail id={selected} titles={titles} onChanged={reload} />
                  </>
                ) : <div className="card"><Empty icon="spark" title="Choose prepared work to review it" /></div>}
              </section>
            </div>
          </>
        );
      }}
    </Show>
  );
}

function NoStaff({ plan }: { plan: string }) {
  return (
    <section>
      <PageHeader title="Staff Room" />
      <div className="card">
      <p>Staff are part of the Staff plan. You are on the {plan === 'diy' || plan === 'none' ? 'free tools' : plan} plan, and every team tool still works without it.</p>
      <Notice tone="info">Plan purchase is not connected in this environment, so there is nothing to buy here.</Notice>
      </div>
    </section>
  );
}

type Block = { title: string; drill: string; minutes: number; notes: string };
type Recipient = { name: string; person_id: string };

function WorkDetail({ id, titles, onChanged }: { id: string; titles: Partial<Record<StaffRoleId, string>>; onChanged: () => void }) {
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
