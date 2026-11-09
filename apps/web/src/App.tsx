import { contextKey, type AppContext } from '@openseason/domain';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './icons';
import { SandboxCheckout } from './sandbox/Checkout';
import { Claim } from './screens/Claim';
import { ClubCompliance, ClubOverview, ClubPayments } from './screens/Club';
import { FamilyFees, FamilyForms, FamilyHome, FamilySchedule } from './screens/Family';
import { Messages } from './screens/Messages';
import { SignIn } from './screens/SignIn';
import { StaffRoom } from './screens/StaffRoom';
import { TeamRoster, TeamSchedule } from './screens/Team';
import { getSandbox, SANDBOX, useSession } from './session';
import { initials, PageHeader } from './ui';

export type Tab = 'home' | 'payments' | 'forms' | 'roster' | 'compliance' | 'staff' | 'messages' | 'join';
export type Go = (tab: Tab) => void;

const KIND_LABEL: Record<AppContext['kind'], string> = { club: 'Club', team: 'Coach', family: 'Family', athlete: 'Me', fan: 'Following' };

interface NavItem { tab: Tab; label: string; icon: IconName }

/** A short menu per role: each item is one job, and Home is always first. */
function navFor(ctx: AppContext | null): NavItem[] {
  const home: NavItem = { tab: 'home', label: 'Home', icon: 'home' };
  const messages: NavItem = { tab: 'messages', label: 'Messages', icon: 'chat' };
  const staff: NavItem = { tab: 'staff', label: 'Staff Room', icon: 'spark' };
  switch (ctx?.kind) {
    case 'club': return [home, { tab: 'payments', label: 'Payments', icon: 'card' }, { tab: 'compliance', label: 'Compliance', icon: 'shield' }, staff, messages];
    case 'team': return [home, { tab: 'roster', label: 'Roster', icon: 'users' }, staff, messages];
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
  const name = s.contexts?.person?.display_name ?? '';

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div className="sidebar-top">
          <span className="brand">Open<span>Season</span></span>
          {s.choices.length > 0 && ctx && (
            <div className="switcher">
              <label htmlFor="ctx">Acting as</label>
              <select id="ctx" value={contextKey(ctx)} onChange={(e) => {
                const next = s.choices.find((c) => contextKey(c) === e.target.value);
                if (next) s.choose(next);
              }}>
                {s.choices.map((c) => <option key={contextKey(c)} value={contextKey(c)}>{KIND_LABEL[c.kind]}: {c.label}</option>)}
              </select>
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
        <main id="main" key={ctx ? contextKey(ctx) : 'none'}>
          {!s.contexts && <p className="loading muted" role="status">Loading…</p>}
          {s.contexts && !ctx && current !== 'messages' && (
            <>
              <PageHeader title={`Welcome${name ? `, ${name.split(' ')[0]}` : ''}`} subtitle="You're signed in, but not connected to a club, team or family yet." />
              <Claim />
            </>
          )}
          {ctx && <Page ctx={ctx} tab={current} go={setTab} />}
          {!ctx && current === 'messages' && <Messages />}
        </main>
      </div>
    </div>
  );
}

function Page({ ctx, tab, go }: { ctx: AppContext; tab: Tab; go: Go }) {
  if (tab === 'messages') return <Messages />;
  if (tab === 'staff') return <StaffRoom ctx={ctx} />;
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
      if (tab === 'payments' && ctx.kind === 'family') return <><PageHeader title="Payments" subtitle="Fees for every athlete in your family." /><FamilyFees /></>;
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
