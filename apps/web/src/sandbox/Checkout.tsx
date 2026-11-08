import { useEffect, useState } from 'react';
import { getSandbox } from '../session';
import { money, Notice } from '../ui';
import type { CheckoutInfo } from './browser';

/**
 * Stand-in for a provider-hosted checkout page in the in-browser sandbox.
 * No card is collected; the buttons record what a provider webhook would.
 */
export function SandboxCheckout({ providerRef, onDone }: { providerRef: string; onDone: () => void }) {
  const [info, setInfo] = useState<CheckoutInfo | null | undefined>(undefined);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void getSandbox().then((s) => s.checkout(providerRef)).then(setInfo, () => setInfo(null)); }, [providerRef]);

  async function finish(outcome: 'succeeded' | 'failed') {
    setBusy(true);
    try {
      await (await getSandbox()).completeCheckout(providerRef, outcome);
      setResult(outcome === 'succeeded' ? 'Sandbox payment recorded as paid.' : 'Sandbox payment recorded as declined.');
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main">
      <section className="card" aria-labelledby="checkout-h">
        <h1 id="checkout-h">Sandbox checkout</h1>
        <Notice tone="warning">Sandbox. No card is collected and no money moves.</Notice>
        {info === undefined && <p className="muted" role="status">Loading…</p>}
        {info === null && <p>This checkout does not exist.</p>}
        {info && <p>Pay {money(info.amount_cents, info.currency)}. Status: {info.status}.</p>}
        {result && <Notice tone="info">{result}</Notice>}
        <div className="row">
          {info && !result && <button type="button" className="btn primary" disabled={busy} onClick={() => finish('succeeded')}>Simulate success</button>}
          {info && !result && <button type="button" className="btn" disabled={busy} onClick={() => finish('failed')}>Simulate decline</button>}
          <button type="button" className="btn quiet" onClick={onDone}>Back to OpenSeason</button>
        </div>
      </section>
    </main>
  );
}
