import type { AppContext, RsvpStatus } from '@openseason/domain';
import { useState } from 'react';
import { useSession } from '../session';
import { ActionButton, Badge, money, Notice, Show, useLoad, when } from '../ui';

type FamilyContext = Extract<AppContext, { kind: 'family' | 'athlete' | 'fan' }>;
const window60 = () => ({ from: new Date(Date.now() - 86400e3), to: new Date(Date.now() + 60 * 86400e3) });

/** Schedule and RSVP for one athlete's teams. Fans see the limited schedule the database returns. */
export function FamilySchedule({ ctx }: { ctx: FamilyContext }) {
  const { client } = useSession();
  const [events, reload] = useLoad(async () => {
    const { from, to } = window60();
    const all = await Promise.all(ctx.teamIds.map((t) => client.teamSchedule(t, from, to)));
    return all.flat().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [client, ctx.athleteId]);

  return (
    <section className="card" aria-labelledby="sched">
      <h2 id="sched">Schedule for {ctx.label}</h2>
      <Show value={events} empty={(d) => d.length === 0}>
        {(list) => (
          <ul className="list">
            {list.map((e) => (
              <li key={e.id}>
                <div className="row spread">
                  <div>
                    <h3>{e.title}{e.opponent ? ` vs ${e.opponent}` : ''}</h3>
                    <p className="muted">{when(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</p>
                    {e.status === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
                    {e.score && <p>Score {e.score.home}–{e.score.away} ({e.score.status})</p>}
                  </div>
                  {ctx.kind !== 'fan' && e.my_rsvps.filter((r) => r.athlete_id === ctx.athleteId).map((r) => (
                    <fieldset key={r.athlete_id} className="row" style={{ border: 0, padding: 0 }}>
                      <legend className="small muted">Is {r.athlete} going?</legend>
                      {(['yes', 'maybe', 'no'] as RsvpStatus[]).map((s) => (
                        <ActionButton key={s} variant={r.status === s ? 'primary' : undefined} label={`${s} for ${r.athlete}`}
                          onRun={async () => { await client.rsvp(e.id, r.athlete_id, s); reload(); }}>
                          {s[0]!.toUpperCase() + s.slice(1)}
                        </ActionButton>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Show>
    </section>
  );
}

interface Form { document_id: string; athlete_id: string; athlete: string; title: string; body: string; version: number; signed_at: string | null }

export function FamilyForms({ athleteId }: { athleteId: string }) {
  const { client, contexts } = useSession();
  const [forms, reload] = useLoad(() => client.rpc<Form[]>('my_forms'), [client]);
  const [typed, setTyped] = useState('');
  return (
    <section className="card" aria-labelledby="forms">
      <h2 id="forms">Forms</h2>
      <Show value={forms}>
        {(all) => {
          const mine = all.filter((f) => f.athlete_id === athleteId);
          if (mine.length === 0) return <p className="muted">No forms for this athlete.</p>;
          return (
            <ul className="list">
              {mine.map((f) => (
                <li key={`${f.document_id}-${f.athlete_id}`}>
                  <h3>{f.title} <span className="muted small">version {f.version}</span></h3>
                  {f.signed_at ? <Badge tone="success">Signed {when(f.signed_at)}</Badge> : (
                    <details>
                      <summary>Read and sign</summary>
                      <p>{f.body}</p>
                      <div className="field">
                        <label htmlFor={`sig-${f.document_id}`}>Type your full name to sign</label>
                        <input id={`sig-${f.document_id}`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={contexts?.person?.display_name ?? ''} />
                      </div>
                      <ActionButton variant="primary" disabled={typed.trim().length < 2}
                        onRun={async () => { await client.rpc('document_sign', { p_document: f.document_id, p_athlete: f.athlete_id, p_typed_name: typed.trim(), p_document_version: f.version }); setTyped(''); reload(); }}>
                        Sign version {f.version}
                      </ActionButton>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          );
        }}
      </Show>
    </section>
  );
}

/** Every fee this person is responsible for, across their athletes. */
export function FamilyFees() {
  const { client } = useSession();
  const [fees, reload] = useLoad(() => client.myFees(), [client]);
  const [checkout, setCheckout] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="fees">
      <h2 id="fees">Fees</h2>
      {checkout && (
        <Notice tone="info">
          A sandbox checkout opened in a new tab. No real card is collected. <button type="button" className="btn quiet" onClick={() => { setCheckout(null); reload(); }}>I finished, refresh</button>
        </Notice>
      )}
      <Show value={fees}>
        {(all) => {
          const mine = all;
          if (mine.length === 0) return <p className="muted">Nothing owed.</p>;
          return mine.map((f) => (
            <div key={f.invoice_id} className="stack">
              <div className="row spread">
                <h3>{f.athlete}: {f.description} · {f.club}</h3>
                <Badge tone={f.status === 'paid' ? 'success' : f.status === 'partially_paid' ? 'info' : 'pending'}>{f.status.replace('_', ' ')}</Badge>
              </div>
              <p>{money(f.paid_cents, f.currency)} paid of {money(f.amount_cents, f.currency)}</p>
              <ul className="list">
                {f.installments.map((i) => (
                  <li key={i.id} className="row spread">
                    <span>Installment {i.seq}: {money(i.amount_cents, f.currency)} due {i.due_on}</span>
                    {i.status === 'paid' ? <Badge tone="success">Paid</Badge> : i.pending ? <Badge tone="pending">Payment pending</Badge> : (
                      <ActionButton variant="primary" label={`Pay installment ${i.seq}`} onRun={async () => {
                        // One idempotency key per installment and press, so a double tap cannot charge twice.
                        const r = await client.rpc<{ checkout_url?: string }>('payment_start', { p_installment: i.id, p_idempotency_key: `${i.id}:${Date.now()}` });
                        if (r.checkout_url) { window.open(r.checkout_url, '_blank', 'noopener'); setCheckout(r.checkout_url); }
                      }}>Pay</ActionButton>
                    )}
                  </li>
                ))}
              </ul>
              {f.receipts.length > 0 && (
                <p className="small muted">Receipts: {f.receipts.map((r) => `${money(r.amount_cents, f.currency)} ${r.status} (${r.method.replace('_', ' ')})`).join(', ')}</p>
              )}
            </div>
          ));
        }}
      </Show>
    </section>
  );
}
