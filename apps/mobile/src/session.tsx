import { httpTransport, OpenSeasonClient } from '@openseason/api-client';
import type { Contexts } from '@openseason/contracts';
import { contextKey, type AppContext } from '@openseason/domain';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Android emulators reach the host machine at 10.0.2.2; set EXPO_PUBLIC_GATEWAY_URL for a device. */
export const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:8787';
const TOKEN_KEY = 'os.session';

interface Session {
  client: OpenSeasonClient;
  ready: boolean;
  signedIn: boolean;
  contexts: Contexts | null;
  active: AppContext | null;
  choices: AppContext[];
  choose: (c: AppContext) => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

function choicesOf(c: Contexts): AppContext[] {
  return [
    ...c.clubs.map((x) => ({ kind: 'club' as const, orgId: x.org_id, label: x.label, permissions: x.permissions as never })),
    ...c.teams.map((x) => ({ kind: 'team' as const, teamId: x.team_id, orgId: x.org_id, label: x.label, role: x.role as never })),
    ...c.family.map((x) => ({ kind: 'family' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.athlete.map((x) => ({ kind: 'athlete' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.fan.map((x) => ({ kind: 'fan' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
  ];
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The token lives in the OS keychain/keystore, never in plain storage.
  const client = useMemo(() => new OpenSeasonClient(httpTransport({ baseUrl: GATEWAY_URL, getToken: () => SecureStore.getItemAsync(TOKEN_KEY) })), []);
  const [contexts, setContexts] = useState<Contexts | null>(null);
  const [active, setActive] = useState<AppContext | null>(null);

  useEffect(() => { SecureStore.getItemAsync(TOKEN_KEY).then((t) => { setToken(t); setReady(true); }, () => setReady(true)); }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    client.signOut();
    setToken(null);
    setContexts(null);
    setActive(null);
  }, [client]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    client.setScope(token, null);
    client.contexts().then((c) => {
      if (!live) return;
      setContexts(c);
      client.setScope(c.person?.id ?? token, null);
      setActive((p) => p ?? choicesOf(c)[0] ?? null);
    }, (e) => { if (live && (e as { kind?: string }).kind === 'unauthenticated') void signOut(); });
    return () => { live = false; };
  }, [token, client, signOut]);

  const value: Session = {
    client, ready, signedIn: Boolean(token), contexts, active,
    choices: contexts ? choicesOf(contexts) : [],
    choose: (c) => { client.setScope(contexts?.person?.id ?? null, contextKey(c)); setActive(c); },
    signIn: async (t) => { await SecureStore.setItemAsync(TOKEN_KEY, t); client.signOut(); setActive(null); setToken(t); },
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
