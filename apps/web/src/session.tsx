import { httpTransport, OpenSeasonClient } from '@openseason/api-client';
import type { Contexts, Tenants } from '@openseason/contracts';
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

export type Tenant = Tenants['tenants'][number];
/** The kind of role a person is acting in, as in the prototype's mode switcher. */
export type Role = AppContext['kind'];
/** One place a person can act: a role, the thing it is about (club, team, child), and the club it belongs to. */
export interface Scope { tenant: Tenant; ctx: AppContext }

const ROLE_ORDER: Role[] = ['club', 'team', 'family', 'athlete', 'fan'];

interface Session {
  client: OpenSeasonClient;
  signedIn: boolean;
  person: Tenants['person'];
  /** Clubs this person belongs to; null while loading. */
  tenants: Tenant[] | null;
  /** The club of the active scope. Every list in the app is read inside it. */
  tenant: Tenant | null;
  /** The active club's roles for this person. */
  contexts: Contexts | null;
  /** The active role and scope. */
  active: AppContext | null;
  /** Every role this person holds, across all their clubs. */
  roles: Role[];
  /** Every scope this person can act in, across all their clubs. */
  scopes: Scope[];
  choose: (s: Scope) => void;
  chooseRole: (r: Role) => void;
  /** Re-read the club list, e.g. after joining a team. */
  reloadTenants: () => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Every place this person can act inside one club. */
export function contextChoices(c: Omit<Contexts, 'person'>): AppContext[] {
  return [
    ...c.clubs.map((x) => ({ kind: 'club' as const, orgId: x.org_id, label: x.label, permissions: x.permissions as never })),
    ...c.teams.map((x) => ({ kind: 'team' as const, teamId: x.team_id, orgId: x.org_id, label: x.label, role: x.role as never })),
    ...c.family.map((x) => ({ kind: 'family' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.athlete.map((x) => ({ kind: 'athlete' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
    ...c.fan.map((x) => ({ kind: 'fan' as const, athleteId: x.athlete_id, label: x.label, teamIds: x.team_ids })),
  ];
}

/** Every scope across clubs, ordered by role and then by club. */
export function allScopes(tenants: Tenant[]): Scope[] {
  const out = tenants.flatMap((tenant) => contextChoices(tenant.contexts).map((ctx) => ({ tenant, ctx })));
  return out.sort((a, b) => ROLE_ORDER.indexOf(a.ctx.kind) - ROLE_ORDER.indexOf(b.ctx.kind));
}

export const scopeKey = (s: { tenant: { id: string }; ctx: AppContext }) => `${s.tenant.id}|${contextKey(s.ctx)}`;

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
  const [tenantList, setTenantList] = useState<Tenants | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const clear = useCallback(() => {
    setTenantList(null);
    setActiveKey(null);
  }, []);

  const signOut = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
    client.signOut();
    setToken(null);
    clear();
  }, [client, clear]);

  const fail = useCallback((e: unknown) => { if ((e as { kind?: string }).kind === 'unauthenticated') signOut(); }, [signOut]);

  // Which clubs this person belongs to, and their roles in each.
  useEffect(() => {
    if (!token && !injected) return;
    let live = true;
    client.setScope(token ?? 'injected', null);
    client.tenants().then((t) => {
      if (!live) return;
      setTenantList(t);
      const scopes = allScopes(t.tenants);
      setActiveKey((prev) => (prev && scopes.some((s) => scopeKey(s) === prev) ? prev : scopes[0] ? scopeKey(scopes[0]) : null));
    }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [token, client, injected, fail, reloadKey]);

  const scopes = useMemo(() => (tenantList ? allScopes(tenantList.tenants) : []), [tenantList]);
  const current = scopes.find((s) => scopeKey(s) === activeKey) ?? null;
  const personId = tenantList?.person?.id ?? null;

  // Each scope gets its own cache, so nothing read in one club or role can show in another.
  if (current && personId) client.setScope(personId, `tenant:${current.tenant.id}|${contextKey(current.ctx)}`);

  const choose = useCallback((s: Scope) => setActiveKey(scopeKey(s)), []);
  const chooseRole = useCallback((r: Role) => {
    if (current?.ctx.kind === r) return;
    // Stay in the same club when the person holds that role there too.
    const next = scopes.find((s) => s.ctx.kind === r && s.tenant.id === current?.tenant.id) ?? scopes.find((s) => s.ctx.kind === r);
    if (next) setActiveKey(scopeKey(next));
  }, [current, scopes]);

  const value: Session = {
    client,
    signedIn: Boolean(token) || Boolean(injected),
    person: tenantList?.person ?? null,
    tenants: tenantList?.tenants ?? null,
    tenant: current?.tenant ?? null,
    contexts: current ? { person: tenantList!.person, ...current.tenant.contexts } : null,
    active: current?.ctx ?? null,
    roles: ROLE_ORDER.filter((r) => scopes.some((s) => s.ctx.kind === r)),
    scopes,
    choose,
    chooseRole,
    reloadTenants: () => setReloadKey((n) => n + 1),
    signIn: async (t) => {
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
      client.signOut();
      clear();
      setToken(t);
    },
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
