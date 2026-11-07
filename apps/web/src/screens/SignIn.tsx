import { useEffect, useState } from 'react';
import { GATEWAY_URL, useSession } from '../session';
import { Notice } from '../ui';

/**
 * Local sandbox sign-in: pick one of the synthetic seed people. Hosted builds
 * replace this with Supabase Auth (email link or passkey); see docs/SECURITY.md.
 */
export function SignIn({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const { signIn } = useSession();
  const [personas, setPersonas] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchImpl(`${GATEWAY_URL}/auth/personas`)
      .then((r) => r.json())
      .then((b: { data: { id: string; label: string }[] }) => setPersonas(b.data))
      .catch(() => setError('The local gateway is not running. Start it with pnpm dev:gateway.'));
  }, [fetchImpl]);

  async function choose(id: string) {
    setError(null);
    try {
      const r = await fetchImpl(`${GATEWAY_URL}/auth/dev-sign-in`, { method: 'POST', body: JSON.stringify({ persona: id }) });
      const b = (await r.json()) as { data?: { token: string }; error?: { message: string } };
      if (!b.data) throw new Error(b.error?.message ?? 'Sign-in failed');
      await signIn(b.data.token);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main id="main">
      <h1>Sign in to OpenSeason</h1>
      <Notice tone="info">Sandbox: these are synthetic people from the seed data. There are no passwords and no real accounts.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      {personas && (
        <ul className="list card" aria-label="Synthetic people">
          {personas.map((p) => (
            <li key={p.id} className="row spread">
              <span>{p.label}</span>
              <button type="button" className="btn" onClick={() => choose(p.id)} aria-label={`Sign in as ${p.label}`}>Sign in</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
