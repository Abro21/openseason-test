import { httpTransport, OpenSeasonClient } from '@openseason/api-client';
import type { Contexts, Tenants } from '@openseason/contracts';
import { contextKey, type AppContext } from '@openseason/domain';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Android emulators reach the host machine at 10.0.2.2; set EXPO_PUBLIC_GATEWAY_URL for a device. */
export const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:8787';
const TOKEN_KEY = 'os.session';

export type Tenant = Tenants['tenants'][number];
/** One place to act: a role (club director, coach, parent...), what it is about, and its club. */
export interface Scope { tenant: Tenant; ctx: AppContext }
export const scopeKey = (s: Scope) => `${s.tenant.id}|${contextKey(s.ctx)}`;

interface Session {
  client: OpenSeasonClient;
  ready: boolean;
  signedIn: boolean;
  /** Clubs this person belongs to; null while loading. */
  tenants: Tenant[] | null;
  /** The active club: every list is read inside it. */
  tenant: Tenant | null;
  active: AppContext | null;
  /** Every role and scope this person has, across all their clubs. */
  scopes: Scope[];
  choose: (s: Scope) => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

function choicesOf(c: Omit<Contexts, 'person'>): AppContext[] {
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
  const [list, setList] = useState<Tenants | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => { SecureStore.getItemAsync(TOKEN_KEY).then((t) => { setToken(t); setReady(true); }, () => setReady(true)); }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    client.signOut();
    setToken(null);
    setList(null);
    setActiveKey(null);
  }, [client]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    client.setScope(token, null);
    client.tenants().then((t) => {
      if (!live) return;
      setList(t);
      const first = t.tenants.flatMap((tenant) => choicesOf(tenant.contexts).map((ctx) => ({ tenant, ctx })))[0];
      setActiveKey((p) => p ?? (first ? scopeKey(first) : null));
    }, (e) => { if (live && (e as { kind?: string }).kind === 'unauthenticated') void signOut(); });
    return () => { live = false; };
  }, [token, client, signOut]);

  const scopes = useMemo(() => (list ? list.tenants.flatMap((tenant) => choicesOf(tenant.contexts).map((ctx) => ({ tenant, ctx }))) : []), [list]);
  const current = scopes.find((x) => scopeKey(x) === activeKey) ?? null;
  // Each club and role reads into its own cache, so nothing shows across clubs.
  if (current && list?.person) client.setScope(list.person.id, `tenant:${current.tenant.id}|${contextKey(current.ctx)}`);

  const value: Session = {
    client, ready, signedIn: Boolean(token),
    tenants: list?.tenants ?? null, tenant: current?.tenant ?? null, active: current?.ctx ?? null,
    scopes,
    choose: (x) => setActiveKey(scopeKey(x)),
    signIn: async (t) => { await SecureStore.setItemAsync(TOKEN_KEY, t); client.signOut(); setList(null); setActiveKey(null); setToken(t); },
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
