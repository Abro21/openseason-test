import type { AppContext } from '@openseason/domain';
import { useSession } from '../session';
import { StaffDrafts, WaitingOnYou } from '../staff';
import type { Go } from '../App';
import { Badge, describeError, Empty, money, Notice, PageHeader, shortDate, Show, useLoad } from '../ui';

type ClubContext = Extract<AppContext, { kind: 'club' }>;
interface Finance { outstanding_cents: number; overdue_cents: number; balances: { invoice_id: string; athlete: string; description: string; open_cents: number; status: string }[] }
interface Compliance {
  certifications: { person_id: string; person: string; kind: string; status: string; expires_on: string | null; gap: boolean }[];
  unsigned_forms: { team: string; athlete: string; document: string }[];
}

const STATUS: Record<string, string> = { paid: 'Paid', partially_paid: 'Partly paid', open: 'Open', overdue: 'Overdue' };

function useClubData(ctx: ClubContext) {
  const { client } = useSession();
  const [finance] = useLoad(() => client.rpc<Finance>('org_finance_summary', { p_org: ctx.orgId }), [client, ctx.orgId]);
  const [comp] = useLoad(() => client.rpc<Compliance>('compliance_overview', { p_org: ctx.orgId }), [client, ctx.orgId]);
  return { finance, comp };
}

/** A director's home: four numbers, each opening the page that deals with it. */
export function ClubOverview({ ctx, go }: { ctx: ClubContext; go: Go }) {
  const { finance, comp } = useClubData(ctx);
  const f = finance.state === 'ready' ? finance.data : null;
  const c = comp.state === 'ready' ? comp.data : null;
  const gaps = c?.certifications.filter((x) => x.gap).length;
  const dash = '–';
  return (
    <>
      <PageHeader title={ctx.label} subtitle="Club overview" />
      {finance.state === 'error' && <Notice tone="danger">{describeError(finance.error)}</Notice>}
      {comp.state === 'error' && <Notice tone="danger">{describeError(comp.error)}</Notice>}
      <section className="stats" aria-label="Club at a glance">
        <button type="button" className="stat" onClick={() => go('payments')}>
          <span className="stat-label">Outstanding</span>
          <span className="stat-value">{f ? money(f.outstanding_cents) : dash}</span>
          <span className="stat-foot muted">{f ? `${f.balances.filter((b) => b.open_cents > 0).length} open balances` : 'Loading…'}</span>
        </button>
        <button type="button" className="stat" onClick={() => go('payments')}>
          <span className="stat-label">Overdue</span>
          <span className={`stat-value ${f && f.overdue_cents > 0 ? 'warn' : ''}`}>{f ? money(f.overdue_cents) : dash}</span>
          <span className="stat-foot muted">Past the due date</span>
        </button>
        <button type="button" className="stat" onClick={() => go('compliance')}>
          <span className="stat-label">Certification gaps</span>
          <span className={`stat-value ${gaps ? 'warn' : ''}`}>{c ? gaps : dash}</span>
          <span className="stat-foot muted">{c ? `of ${c.certifications.length} on file` : 'Loading…'}</span>
        </button>
        <button type="button" className="stat" onClick={() => go('compliance')}>
          <span className="stat-label">Unsigned forms</span>
          <span className={`stat-value ${c && c.unsigned_forms.length > 0 ? 'warn' : ''}`}>{c ? c.unsigned_forms.length : dash}</span>
          <span className="stat-foot muted">Across all teams</span>
        </button>
      </section>
      <WaitingOnYou />
    </>
  );
}

export function ClubPayments({ ctx }: { ctx: ClubContext }) {
  const { finance } = useClubData(ctx);
  return (
    <>
      <PageHeader title="Payments" subtitle={ctx.label} />
      <StaffDrafts match={(w) => w.kind === 'fee_reminder' && w.org_id === ctx.orgId}
        prepare={finance.state === 'ready' && finance.data.overdue_cents > 0 ? { kind: 'fee_reminder', label: 'reminders to families with overdue balances', target: { org_id: ctx.orgId } } : undefined} />
      <Show value={finance}>
        {(f) => (
          <section className="card flush" aria-labelledby="bal">
            <div className="card-head">
              <h2 id="bal">Balances</h2>
              <span className="muted small"><strong className="text">{money(f.outstanding_cents)}</strong> outstanding · {money(f.overdue_cents)} overdue</span>
            </div>
            {f.balances.length === 0 ? <Empty icon="card" title="No balances">Fees you invoice show up here.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Athlete</th><th scope="col">Fee</th><th scope="col" className="num">Open</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {f.balances.map((b) => (
                      <tr key={b.invoice_id}>
                        <td>{b.athlete}</td>
                        <td className="muted">{b.description}</td>
                        <td className="num">{money(b.open_cents)}</td>
                        <td><Badge tone={b.status === 'paid' ? 'success' : b.status === 'overdue' ? 'warning' : 'pending'}>{STATUS[b.status] ?? b.status.replace('_', ' ')}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </Show>
    </>
  );
}

export function ClubCompliance({ ctx }: { ctx: ClubContext }) {
  const { comp } = useClubData(ctx);
  return (
    <>
      <PageHeader title="Compliance" subtitle="The club's own records. OpenSeason does not certify SafeSport or COPPA compliance." />
      <StaffDrafts match={(w) => w.kind === 'certification_nudge' && w.org_id === ctx.orgId}
        prepare={comp.state === 'ready' && comp.data.certifications.some((x) => x.gap) ? { kind: 'certification_nudge', label: 'nudges to staff with missing or expiring certifications', target: { org_id: ctx.orgId } } : undefined} />
      <Show value={comp}>
        {(c) => (
          <div className="stack-lg">
            <section className="card flush" aria-labelledby="certs">
              <div className="card-head"><h2 id="certs">Staff certifications</h2></div>
              {c.certifications.length === 0 ? <Empty icon="shield" title="No certifications on file" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th scope="col">Person</th><th scope="col">Certification</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {c.certifications.map((x) => (
                        <tr key={`${x.person_id}-${x.kind}`}>
                          <td>{x.person}</td>
                          <td className="muted">{x.kind.replace('_', ' ')}</td>
                          <td><Badge tone={x.gap ? 'warning' : 'success'}>{x.status}{x.expires_on ? `, expires ${shortDate(x.expires_on)}` : ''}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card flush" aria-labelledby="unsigned">
              <div className="card-head"><h2 id="unsigned">Unsigned forms</h2></div>
              {c.unsigned_forms.length === 0 ? <Empty icon="check" title="Every form is signed" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th scope="col">Athlete</th><th scope="col">Team</th><th scope="col">Form</th></tr></thead>
                    <tbody>{c.unsigned_forms.map((u, i) => <tr key={i}><td>{u.athlete}</td><td className="muted">{u.team}</td><td>{u.document}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </Show>
    </>
  );
}
