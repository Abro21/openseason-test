import { useEffect, useState } from 'react';
import { GATEWAY_URL, getSandbox, SANDBOX, useSession } from '../session';
import { initials, Notice } from '../ui';

/**
 * Local sandbox sign-in: pick one of the synthetic seed people. Hosted builds
 * replace this with Supabase Auth (email link or passkey); see docs/SECURITY.md.
 */
export function SignIn({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const { signIn } = useSession();
  const [personas, setPersonas] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (SANDBOX) {
      getSandbox().then((s) => setPersonas(s.personas()), (e: Error) => setError(e.message));
      return;
    }
    fetchImpl(`${GATEWAY_URL}/auth/personas`)
      .then((r) => r.json())
      .then((b: { data: { id: string; label: string }[] }) => setPersonas(b.data))
      .catch(() => setError('The local gateway is not running. Start it with pnpm dev:gateway.'));
  }, [fetchImpl]);

  async function choose(id: string) {
    setError(null);
    try {
      if (SANDBOX) return await signIn((await getSandbox()).tokenFor(id));
      const r = await fetchImpl(`${GATEWAY_URL}/auth/dev-sign-in`, { method: 'POST', body: JSON.stringify({ persona: id }) });
      const b = (await r.json()) as { data?: { token: string }; error?: { message: string } };
      if (!b.data) throw new Error(b.error?.message ?? 'Sign-in failed');
      await signIn(b.data.token);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="signin">
      <section className="signin-hero" aria-hidden="true">
        <span className="brand">Open<span>Season</span></span>
        <p className="display">Your whole season.<br />One place.</p>
        <p className="hero-sub">Schedules, RSVPs, forms, fees and team messages for families, coaches and clubs.</p>
      </section>
      <main id="main" className="signin-panel">
        <h1>Sign in</h1>
        <p className="muted">Pick a sample person to see OpenSeason through their eyes.</p>
        <Notice tone="info">
          Sandbox: these are synthetic people from the seed data. There are no passwords and no real accounts.
          {SANDBOX && ' The whole app, database included, runs in this browser, and nothing you do is sent anywhere.'}
        </Notice>
        {SANDBOX && !personas && !error && <p className="loading muted" role="status">Setting up your sandbox…</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        {personas && (
          <ul className="personas" aria-label="Synthetic people">
            {personas.map((p) => {
              const [name, ...rest] = p.label.split(': ');
              return (
                <li key={p.id}>
                  <button type="button" className="persona" onClick={() => choose(p.id)} aria-label={`Sign in as ${p.label}`}>
                    <span className="avatar" aria-hidden="true">{initials(name ?? p.label)}</span>
                    <span className="persona-text">
                      <strong>{name}</strong>
                      {rest.length > 0 && <span className="muted small">{rest.join(': ')}</span>}
                    </span>
                    <span className="persona-go" aria-hidden="true">Sign in</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
