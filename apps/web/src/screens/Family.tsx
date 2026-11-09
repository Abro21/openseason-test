import type { AppContext, RsvpStatus } from '@openseason/domain';
import { useState } from 'react';
import type { Go } from '../App';
import { Icon } from '../icons';
import { useSession } from '../session';
import { ActionButton, Badge, DateTile, Empty, money, Notice, PageHeader, shortDate, Show, time, useLoad, when } from '../ui';

type FamilyContext = Extract<AppContext, { kind: 'family' | 'athlete' | 'fan' }>;
const window60 = () => ({ from: new Date(Date.now() - 86400e3), to: new Date(Date.now() + 60 * 86400e3) });
const RSVP_LABEL: Record<RsvpStatus, string> = { yes: 'Going', maybe: 'Maybe', no: "Can't go" };

interface Form { document_id: string; athlete_id: string; athlete: string; title: string; body: string; version: number; signed_at: string | null }

/** Home for a family member or athlete: what needs them, then what's coming up. */
export function FamilyHome({ ctx, go }: { ctx: Extract<AppContext, { kind: 'family' | 'athlete' }>; go: Go }) {
  const { client, tenant } = useSession();
  const tid = tenant!.id;
  const [forms] = useLoad(() => client.rpc<Form[]>('my_forms', { p_tenant: tid }), [client, tid]);
  const [fees] = useLoad(() => (ctx.kind === 'family' ? client.myFees(tid) : Promise.resolve([])), [client, ctx.kind, tid]);
  const unsigned = forms.state === 'ready' ? forms.data.filter((f) => f.athlete_id === ctx.athleteId && !f.signed_at).length : 0;
  const due = fees.state === 'ready'
    ? fees.data.flatMap((f) => f.installments.filter((i) => i.status !== 'paid' && !i.pending).map((i) => ({ ...i, currency: f.currency }))).sort((a, b) => a.due_on.localeCompare(b.due_on))
    : [];
  const dueTotal = due.reduce((n, i) => n + i.amount_cents, 0);

  return (
    <>
      <PageHeader title={ctx.label} subtitle="What needs you, then what's coming up." />
      {(unsigned > 0 || due.length > 0) && (
        <section className="todo-row" aria-label="Needs you">
          {due.length > 0 && (
            <button type="button" className="todo" onClick={() => go('payments')}>
              <span className="todo-icon tone-warning"><Icon name="card" /></span>
              <span className="todo-text">
                <strong>{money(dueTotal, due[0]!.currency)} to pay</strong>
                <span className="muted small">Next due {shortDate(due[0]!.due_on)}</span>
              </span>
            </button>
          )}
          {unsigned > 0 && (
            <button type="button" className="todo" onClick={() => go('forms')}>
              <span className="todo-icon tone-info"><Icon name="file" /></span>
              <span className="todo-text">
                <strong>{unsigned} form{unsigned === 1 ? '' : 's'} to sign</strong>
                <span className="muted small">For {ctx.label}</span>
              </span>
            </button>
          )}
        </section>
      )}
      <FamilySchedule ctx={ctx} />
      {ctx.kind === 'family' && (
        <p className="join-link"><button type="button" className="link-btn" onClick={() => go('join')}><Icon name="plus" size={16} /> Have an invite code? Join a team</button></p>
      )}
    </>
  );
}

/** Schedule and RSVP for one athlete's teams. Fans see the limited schedule the database returns. */
export function FamilySchedule({ ctx }: { ctx: FamilyContext }) {
  const { client } = useSession();
  const [events, reload] = useLoad(async () => {
    const { from, to } = window60();
    const all = await Promise.all(ctx.teamIds.map((t) => client.teamSchedule(t, from, to)));
    return all.flat().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [client, ctx.athleteId]);

  return (
    <section className="card flush" aria-labelledby="sched">
      <div className="card-head"><h2 id="sched">Coming up</h2></div>
      <Show value={events} empty={(d) => d.length === 0} emptyView={<Empty icon="calendar" title="Nothing scheduled">Games and practices for the next two months show up here.</Empty>}>
        {(list) => (
          <ul className="events">
            {list.map((e) => {
              const mine = ctx.kind !== 'fan' ? e.my_rsvps.filter((r) => r.athlete_id === ctx.athleteId) : [];
              return (
                <li key={e.id} className={`event ${e.status === 'cancelled' ? 'cancelled' : ''}`}>
                  <DateTile iso={e.starts_at} />
                  <div className="event-main">
                    <div className="event-title">
                      <span className={`kind-dot ${e.kind === 'game' ? 'game' : ''}`} aria-hidden="true" />
                      {e.title}{e.opponent ? ` vs ${e.opponent}` : ''}
                      {e.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
                      {e.score && <Badge tone={e.score.status === 'final' ? 'neutral' : 'info'}>{e.score.status === 'final' ? 'Final' : 'Live'} {e.score.home}–{e.score.away}</Badge>}
                    </div>
                    <p className="muted small"><span className="sr-only">{when(e.starts_at)}</span><span aria-hidden="true">{time(e.starts_at)}</span>{e.location ? ` · ${e.location}` : ''}</p>
                  </div>
                  {mine.map((r) => (
                    <fieldset key={r.athlete_id} className="segmented">
                      <legend className="sr-only">Is {r.athlete} going?</legend>
                      {(['yes', 'maybe', 'no'] as RsvpStatus[]).map((s) => (
                        <ActionButton key={s} className="seg" pressed={r.status === s} label={`${s} for ${r.athlete}`}
                          onRun={async () => { await client.rsvp(e.id, r.athlete_id, s); reload(); }}>
                          {RSVP_LABEL[s]}
                        </ActionButton>
                      ))}
                    </fieldset>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </Show>
    </section>
  );
}

export function FamilyForms({ athleteId }: { athleteId: string }) {
  const { client, person, tenant } = useSession();
  const tid = tenant!.id;
  const [forms, reload] = useLoad(() => client.rpc<Form[]>('my_forms', { p_tenant: tid }), [client, tid]);
  const [typed, setTyped] = useState('');
  return (
    <Show value={forms}>
      {(all) => {
        const mine = all.filter((f) => f.athlete_id === athleteId);
        if (mine.length === 0) return <div className="card"><Empty icon="file" title="No forms">When the club asks for a waiver or form, it shows up here.</Empty></div>;
        return (
          <div className="stack-lg">
            {mine.map((f) => (
              <section key={`${f.document_id}-${f.athlete_id}`} className="card" aria-labelledby={`f-${f.document_id}`}>
                <div className="card-row">
                  <span className="doc-icon"><Icon name="file" /></span>
                  <div className="grow">
                    <h2 id={`f-${f.document_id}`}>{f.title}</h2>
                    <p className="muted small">Version {f.version}</p>
                  </div>
                  {f.signed_at ? <Badge tone="success">Signed {when(f.signed_at)}</Badge> : <Badge tone="warning">Needs signature</Badge>}
                </div>
                {!f.signed_at && (
                  <details className="disclosure">
                    <summary>Read and sign</summary>
                    <p className="doc-body">{f.body}</p>
                    <div className="field">
                      <label htmlFor={`sig-${f.document_id}`}>Type your full name to sign</label>
                      <input id={`sig-${f.document_id}`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={person?.display_name ?? ''} />
                    </div>
                    <ActionButton variant="primary" disabled={typed.trim().length < 2}
                      onRun={async () => { await client.rpc('document_sign', { p_document: f.document_id, p_athlete: f.athlete_id, p_typed_name: typed.trim(), p_document_version: f.version }); setTyped(''); reload(); }}>
                      Sign version {f.version}
                    </ActionButton>
                  </details>
                )}
              </section>
            ))}
          </div>
        );
      }}
    </Show>
  );
}

const FEE_STATUS: Record<string, string> = { paid: 'Paid', partially_paid: 'Partly paid', open: 'Open', overdue: 'Overdue' };

/** Every fee this person is responsible for in the active club, across their athletes. */
export function FamilyFees() {
  const { client, tenant } = useSession();
  const tid = tenant!.id;
  const [fees, reload] = useLoad(() => client.myFees(tid), [client, tid]);
  const [checkout, setCheckout] = useState<string | null>(null);
  return (
    <>
      {checkout && (
        <Notice tone="info">
          A sandbox checkout opened in a new tab. No real card is collected. <button type="button" className="link-btn" onClick={() => { setCheckout(null); reload(); }}>I finished, refresh</button>
        </Notice>
      )}
      <Show value={fees}>
        {(all) => {
          if (all.length === 0) return <div className="card"><Empty icon="card" title="Nothing owed">You're all paid up.</Empty></div>;
          return (
            <div className="stack-lg">
              {all.map((f) => {
                const pct = f.amount_cents > 0 ? Math.round((f.paid_cents / f.amount_cents) * 100) : 0;
                return (
                  <section key={f.invoice_id} className="card" aria-labelledby={`inv-${f.invoice_id}`}>
                    <div className="card-row">
                      <div className="grow">
                        <h2 id={`inv-${f.invoice_id}`}>{f.description}</h2>
                        <p className="muted small">{f.athlete} · {f.club}</p>
                      </div>
                      <Badge tone={f.status === 'paid' ? 'success' : f.status === 'partially_paid' ? 'info' : 'pending'}>{FEE_STATUS[f.status] ?? f.status.replace('_', ' ')}</Badge>
                    </div>
                    <div className="progress-block">
                      <div className="progress-label"><strong>{money(f.paid_cents, f.currency)}</strong><span className="muted"> paid of {money(f.amount_cents, f.currency)}</span></div>
                      <div className="progress" role="progressbar" aria-label={`${f.description} paid`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
                    </div>
                    <ul className="rows">
                      {f.installments.map((i) => (
                        <li key={i.id} className="row-item">
                          <div className="grow">
                            <strong>{money(i.amount_cents, f.currency)}</strong>
                            <span className="muted small"> · Installment {i.seq}, due {shortDate(i.due_on)}</span>
                          </div>
                          {i.status === 'paid' ? <Badge tone="success">Paid</Badge> : i.pending ? <Badge tone="pending">Payment pending</Badge> : (
                            <ActionButton variant="primary" label={`Pay installment ${i.seq}`} onRun={async () => {
                              // One idempotency key per installment and press, so a double tap cannot charge twice.
                              const r = await client.rpc<{ checkout_url?: string }>('payment_start', { p_installment: i.id, p_idempotency_key: `${i.id}:${Date.now()}` });
                              if (r.checkout_url?.startsWith('#')) window.location.hash = r.checkout_url; // in-browser sandbox checkout
                              else if (r.checkout_url) { window.open(r.checkout_url, '_blank', 'noopener'); setCheckout(r.checkout_url); }
                            }}>Pay</ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                    {f.receipts.length > 0 && (
                      <details className="disclosure quiet">
                        <summary>Receipts ({f.receipts.length})</summary>
                        <ul className="plain small">{f.receipts.map((r, n) => <li key={n}>{money(r.amount_cents, f.currency)} · {r.status} · {r.method.replace('_', ' ')}</li>)}</ul>
                      </details>
                    )}
                  </section>
                );
              })}
            </div>
          );
        }}
      </Show>
    </>
  );
}
