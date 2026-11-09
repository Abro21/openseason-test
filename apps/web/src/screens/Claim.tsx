import { useState } from 'react';
import { useSession } from '../session';
import { Notice, Show, useLoad, when } from '../ui';

interface Candidate { invitation_id: string; kind: string; team_name: string | null; invited_by_name: string | null; expires_at: string }

/**
 * Invitations addressed to this person are shown as candidates only. Joining
 * needs the invite code; guardian claims then wait for the coach's approval.
 */
export function Claim() {
  const { client, reloadTenants } = useSession();
  const [candidates] = useLoad(() => client.rpc<Candidate[]>('my_claim_candidates'), [client]);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const rows = await client.rpc<{ claim_id: string | null; status: string }[]>('claim_submit', { p_token: code.trim() });
      const s = rows[0]?.status;
      if (s === 'approved') { setResult({ tone: 'success', text: 'You are connected. The new role is in the Role switcher.' }); reloadTenants(); }
      else if (s === 'pending_approval') setResult({ tone: 'info', text: 'Request sent. The coach or club confirms it before you can see anything.' });
      else if (s === 'conflict') setResult({ tone: 'info', text: 'Someone else has a request for this record, so the club will sort it out with both of you.' });
      else setResult({ tone: 'danger', text: 'That code did not work. Check it, or ask for a new invitation.' });
      setCode('');
    } catch (e) {
      setResult({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow" aria-labelledby="claim-h">
      <h2 id="claim-h">Join with an invitation</h2>
      <Show value={candidates}>
        {(list) => list.length === 0 ? null : (
          <ul className="rows">
            {list.map((c) => (
              <li key={c.invitation_id} className="row-item"><span className="grow">{c.invited_by_name ?? 'Someone'} invited you as {c.kind}{c.team_name ? ` on ${c.team_name}` : ''}</span> <span className="small muted">Expires {when(c.expires_at)}</span></li>
            ))}
          </ul>
        )}
      </Show>
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <div className="field">
        <label htmlFor="invite-code">Invite code from your email</label>
        <input id="invite-code" value={code} autoComplete="one-time-code" onChange={(e) => setCode(e.target.value)} />
      </div>
      <button type="button" className="btn primary" disabled={busy || code.trim().length < 8} onClick={submit}>{busy ? 'Checking…' : 'Join'}</button>
    </section>
  );
}
