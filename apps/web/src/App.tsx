import type { AppContext } from '@openseason/domain';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './icons';
import { SandboxCheckout } from './sandbox/Checkout';
import { Claim } from './screens/Claim';
import { ClubCompliance, ClubOverview, ClubPayments } from './screens/Club';
import { FamilyFees, FamilyForms, FamilyHome, FamilySchedule } from './screens/Family';
import { Messages } from './screens/Messages';
import { SignIn } from './screens/SignIn';
import { TeamRoster, TeamSchedule } from './screens/Team';
import { getSandbox, SANDBOX, scopeKey, useSession, type Role } from './session';
import { StaffProvider } from './staff';
import { initials, PageHeader } from './ui';

export type Tab = 'home' | 'payments' | 'forms' | 'roster' | 'compliance' | 'messages' | 'join';
export type Go = (tab: Tab) => void;

/** Role names as in the prototype's mode switcher. */
const ROLE_LABEL: Record<Role, string> = { club: 'Club Director', team: 'Coach', family: 'Parent', athlete: 'Player', fan: 'Fan' };
/** What the second switcher picks inside the role. */
const SCOPE_LABEL: Record<Role, string> = { club: 'Club', team: 'Team', family: 'Child', athlete: 'Profile', fan: 'Following' };

interface NavItem { tab: Tab; label: string; icon: IconName }

/** A short menu per role: each item is one job, and Home is always first. */
function navFor(ctx: AppContext | null): NavItem[] {
  const home: NavItem = { tab: 'home', label: 'Home', icon: 'home' };
  const messages: NavItem = { tab: 'messages', label: 'Messages', icon: 'chat' };
  switch (ctx?.kind) {
    case 'club': return [home, { tab: 'payments', label: 'Payments', icon: 'card' }, { tab: 'compliance', label: 'Compliance', icon: 'shield' }, messages];
    case 'team': return [{ ...home, label: 'Schedule', icon: 'calendar' }, { tab: 'roster', label: 'Roster', icon: 'users' }, messages];
    case 'family': return [home, { tab: 'payments', label: 'Payments', icon: 'card' }, { tab: 'forms', label: 'Forms', icon: 'file' }, messages];
    case 'athlete': return [home, { tab: 'forms', label: 'Forms', icon: 'file' }, messages];
    default: return [home, messages];
  }
}

export function App() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const checkoutRef = useSandboxCheckoutRef();
  if (SANDBOX && checkoutRef) return <SandboxCheckout providerRef={checkoutRef} onDone={() => { window.location.hash = ''; }} />;
  if (!s.signedIn) return <SignIn />;
  const ctx = s.active;
  const nav = navFor(ctx);
  const current = tab === 'join' || nav.some((n) => n.tab === tab) ? tab : 'home';
  const name = s.person?.display_name ?? '';
  const inRole = ctx ? s.scopes.filter((x) => x.ctx.kind === ctx.kind) : [];
  const manyClubs = (s.tenants?.length ?? 0) > 1;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div className="sidebar-top">
          <span className="brand">Open<span>Season</span></span>
          {ctx && s.tenant && (
            <div className="switchers">
              <div className="switcher">
                <label htmlFor="role">Role</label>
                <select id="role" value={ctx.kind} onChange={(e) => s.chooseRole(e.target.value as Role)}>
                  {s.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div className="switcher">
                <label htmlFor="scope">{SCOPE_LABEL[ctx.kind]}</label>
                <select id="scope" value={scopeKey({ tenant: s.tenant, ctx })} onChange={(e) => {
                  const next = inRole.find((x) => scopeKey(x) === e.target.value);
                  if (next) s.choose(next);
                }}>
                  {inRole.map((x) => (
                    <option key={scopeKey(x)} value={scopeKey(x)}>{x.ctx.label}{manyClubs && x.ctx.kind !== 'club' ? ` · ${x.tenant.name}` : ''}</option>
                  ))}
                </select>
              </div>
              {ctx.kind !== 'club' && <p className="club-line small"><span className="club-dot" aria-hidden="true" />{s.tenant.name}</p>}
              <button type="button" className="add-role" onClick={() => setTab('join')}><Icon name="plus" size={16} /> Add another role</button>
            </div>
          )}
        </div>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => (
            <button key={n.tab} type="button" className="nav-item" aria-current={current === n.tab ? 'page' : undefined} onClick={() => setTab(n.tab)}>
              <Icon name={n.icon} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar" aria-hidden="true">{initials(name || '?')}</span>
          <span className="who">{name}</span>
          <button type="button" className="icon-btn" onClick={s.signOut} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} /></button>
        </div>
      </aside>
      <div className="content">
        <SandboxStrip />
        <main id="main" key={ctx && s.tenant ? scopeKey({ tenant: s.tenant, ctx }) : 'none'}>
          {!s.tenants && <p className="loading muted" role="status">Loading…</p>}
          {s.tenants && !ctx && (
            <>
              <PageHeader title={`Welcome${name ? `, ${name.split(' ')[0]}` : ''}`} subtitle="You're signed in, but not connected to a club, team or family yet." />
              <Claim />
            </>
          )}
          {ctx && s.tenant && <StaffProvider key={s.tenant.id} tenantId={s.tenant.id}><Page ctx={ctx} tab={current} go={setTab} /></StaffProvider>}
        </main>
      </div>
    </div>
  );
}

function Page({ ctx, tab, go }: { ctx: AppContext; tab: Tab; go: Go }) {
  if (tab === 'messages') return <Messages />;
  if (tab === 'join') return <><PageHeader title="Join a team" subtitle="Use the invite code from your email." /><Claim /></>;
  switch (ctx.kind) {
    case 'club':
      if (tab === 'payments') return <ClubPayments ctx={ctx} />;
      if (tab === 'compliance') return <ClubCompliance ctx={ctx} />;
      return <ClubOverview ctx={ctx} go={go} />;
    case 'team':
      return tab === 'roster' ? <TeamRoster ctx={ctx} /> : <TeamSchedule ctx={ctx} />;
    case 'fan':
      return <><PageHeader title={`Following ${ctx.label}`} subtitle="Public schedule and scores." /><FamilySchedule ctx={ctx} /></>;
    default:
      if (tab === 'payments' && ctx.kind === 'family') return <><PageHeader title="Payments" subtitle="Fees for your family in this club." /><FamilyFees /></>;
      if (tab === 'forms') return <><PageHeader title="Forms" subtitle={`Waivers and forms for ${ctx.label}.`} /><FamilyForms athleteId={ctx.athleteId} /></>;
      return <FamilyHome ctx={ctx} go={go} />;
  }
}

/** Thin strip saying this is a sandbox, with an in-page confirmation for starting over. */
function SandboxStrip() {
  const [confirming, setConfirming] = useState(false);
  if (!SANDBOX) return <div className="sandbox-strip" role="note">Sandbox environment: synthetic data, no real messages, payments or accounts.</div>;
  return (
    <div className="sandbox-strip" role="note">
      {confirming ? (
        <>
          <span>Erase everything you changed and start over with fresh sample data?</span>
          <span className="strip-actions">
            <button type="button" className="strip-btn strong" onClick={resetSandbox}>Erase and start over</button>
            <button type="button" className="strip-btn" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        </>
      ) : (
        <>
          <span><strong>Sandbox:</strong> synthetic data that lives only in this browser. Nothing is sent anywhere.</span>
          <button type="button" className="strip-btn" onClick={() => setConfirming(true)}>Start over</button>
        </>
      )}
    </div>
  );
}

/** The in-browser sandbox shows its stand-in checkout at #sandbox-checkout/<ref>. */
function useSandboxCheckoutRef(): string | null {
  const read = () => window.location.hash.match(/^#sandbox-checkout\/(sbx_cs_[0-9a-f]+)$/)?.[1] ?? null;
  const [ref, setRef] = useState(read);
  useEffect(() => {
    const on = () => setRef(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return ref;
}

async function resetSandbox() {
  await (await getSandbox()).reset();
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  window.location.reload();
}
