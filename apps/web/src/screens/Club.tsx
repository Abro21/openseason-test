import type { AppContext } from '@openseason/domain';
import { useSession } from '../session';
import { Badge, money, Show, useLoad } from '../ui';

type ClubContext = Extract<AppContext, { kind: 'club' }>;
interface Finance { outstanding_cents: number; overdue_cents: number; balances: { invoice_id: string; athlete: string; description: string; open_cents: number; status: string }[] }
interface Compliance {
  certifications: { person_id: string; person: string; kind: string; status: string; expires_on: string | null; gap: boolean }[];
  unsigned_forms: { team: string; athlete: string; document: string }[];
}

export function ClubHome({ ctx }: { ctx: ClubContext }) {
  const { client } = useSession();
  const [finance] = useLoad(() => client.rpc<Finance>('org_finance_summary', { p_org: ctx.orgId }), [client, ctx.orgId]);
  const [comp] = useLoad(() => client.rpc<Compliance>('compliance_overview', { p_org: ctx.orgId }), [client, ctx.orgId]);

  return (
    <div className="grid">
      <section className="card" aria-labelledby="fin">
        <h2 id="fin">Money</h2>
        <Show value={finance}>
          {(f) => (
            <>
              <p><strong>{money(f.outstanding_cents)}</strong> outstanding · {money(f.overdue_cents)} overdue</p>
              <ul className="list">
                {f.balances.map((b) => (
                  <li key={b.invoice_id} className="row spread">
                    <span>{b.athlete}: {b.description}</span>
                    <span>{money(b.open_cents)} <Badge tone={b.status === 'paid' ? 'success' : 'pending'}>{b.status.replace('_', ' ')}</Badge></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Show>
      </section>
      <section className="card" aria-labelledby="comp">
        <h2 id="comp">Compliance</h2>
        <p className="small muted">These are the club's own records. OpenSeason does not certify SafeSport or COPPA compliance.</p>
        <Show value={comp}>
          {(c) => (
            <>
              <h3>Certifications</h3>
              <ul className="list">
                {c.certifications.map((x) => (
                  <li key={`${x.person_id}-${x.kind}`} className="row spread">
                    <span>{x.person}: {x.kind.replace('_', ' ')}</span>
                    <Badge tone={x.gap ? 'warning' : 'success'}>{x.status}{x.expires_on ? `, expires ${x.expires_on}` : ''}</Badge>
                  </li>
                ))}
              </ul>
              <h3>Unsigned forms</h3>
              {c.unsigned_forms.length === 0 ? <p className="muted">None.</p> : (
                <ul className="list">{c.unsigned_forms.map((u, i) => <li key={i}>{u.team} · {u.athlete} · {u.document}</li>)}</ul>
              )}
            </>
          )}
        </Show>
      </section>
    </div>
  );
}
