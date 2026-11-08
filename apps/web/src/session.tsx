import { httpTransport, OpenSeasonClient } from '@openseason/api-client';
import type { Contexts } from '@openseason/contracts';
import { contextKey, type AppContext } from '@openseason/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BrowserSandbox } from './sandbox/browser';

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8787';
/** Hosted demo build: the database runs in the browser, so no server or hosted database is involved. */
export const SANDBOX = import.meta.env.VITE_SANDBOX === 'browser';

let sandbox: Promise<BrowserSandbox> | null = null;
export function getSandbox(): Promise<BrowserSandbox> {
  return (sandbox ??= import('./sandbox/browser').then((m) => m.openSandbox()));
}
const TOKEN_KEY = 'os.session';

interface Session {
  client: OpenSeasonClient;
  signedIn: boolean;
  contexts: Contexts | null;
  active: AppContext | null;
  choices: AppContext[];
  choose: (c: AppContext) => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Every place this person can act, flattened for the context switcher. */
export function contextChoices(c: Contexts): AppContext[] {
  return [
    ...c.clubs.map((x) => ({ kind: 'club' as const, orgId: x.org_id, label: x.label, permissions: x.permissions as never })),
    ...c.teams.map((x) => ({ kind: 'team' as const, teamId: x.team_id, orgId: x.org_id, label: x.label, role: x.role as never })),
    ...c.family.map((x) => ({ kind: 'family' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.athlete.map((x) => ({ kind: 'athlete' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.fan.map((x) => ({ kind: 'fan' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
  ];
}

function readToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function SessionProvider({ children, client: injected }: { children: ReactNode; client?: OpenSeasonClient }) {
  const [token, setToken] = useState<string | null>(readToken);
  const client = useMemo(() => injected ?? new OpenSeasonClient(SANDBOX
    ? { call: async (fn, args) => (await getSandbox()).transport(readToken).call(fn, args) }
    : httpTransport({ baseUrl: GATEWAY_URL, getToken: () => readToken() })), [injected]);

  // The gateway runs its sandbox providers on a timer; the in-browser sandbox does the same while the tab is open.
  useEffect(() => {
    if (!SANDBOX || injected) return;
    const t = setInterval(() => { void getSandbox().then((s) => s.runWorkers()).catch(() => undefined); }, 2000);
    return () => clearInterval(t);
  }, [injected]);
  const [contexts, setContexts] = useState<Contexts | null>(null);
  const [active, setActive] = useState<AppContext | null>(null);

  const signOut = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
    client.signOut();
    setToken(null);
    setContexts(null);
    setActive(null);
  }, [client]);

  useEffect(() => {
    if (!token && !injected) return;
    let live = true;
    client.setScope(token ?? 'injected', null);
    client.contexts().then((c) => {
      if (!live) return;
      setContexts(c);
      client.setScope(c.person?.id ?? token ?? 'injected', null);
      setActive((prev) => prev ?? contextChoices(c)[0] ?? null);
    }, (e) => { if (live && (e as { kind?: string }).kind === 'unauthenticated') signOut(); });
    return () => { live = false; };
  }, [token, client, injected, signOut]);

  const choose = useCallback((c: AppContext) => {
    client.setScope(contexts?.person?.id ?? null, contextKey(c));
    setActive(c);
  }, [client, contexts]);

  const value: Session = {
    client,
    signedIn: Boolean(token) || Boolean(injected),
    contexts,
    active,
    choices: contexts ? contextChoices(contexts) : [],
    choose,
    signIn: async (t) => {
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
      client.signOut();
      setActive(null);
      setToken(t);
    },
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
