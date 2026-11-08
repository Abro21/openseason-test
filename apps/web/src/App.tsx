import { contextKey, type AppContext } from '@openseason/domain';
import { useEffect, useState } from 'react';
import { SandboxCheckout } from './sandbox/Checkout';
import { Claim } from './screens/Claim';
import { ClubHome } from './screens/Club';
import { FamilyFees, FamilyForms, FamilySchedule } from './screens/Family';
import { Messages } from './screens/Messages';
import { SignIn } from './screens/SignIn';
import { StaffRoom } from './screens/StaffRoom';
import { TeamHome } from './screens/Team';
import { getSandbox, SANDBOX, useSession } from './session';

type Tab = 'home' | 'staff' | 'messages';

const KIND_LABEL: Record<AppContext['kind'], string> = { club: 'Club', team: 'Coach', family: 'Family', athlete: 'Me', fan: 'Following' };

export function App() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const checkoutRef = useSandboxCheckoutRef();
  if (SANDBOX && checkoutRef) return <SandboxCheckout providerRef={checkoutRef} onDone={() => { window.location.hash = ''; }} />;
  if (!s.signedIn) return <SignIn />;
  const ctx = s.active;
  const staffTab = ctx && (ctx.kind === 'team' || ctx.kind === 'club');

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <div className="banner" role="note">
        {SANDBOX
          ? <>Sandbox: synthetic data that lives only in this browser. Nothing is sent anywhere. <button type="button" className="btn quiet" onClick={resetSandbox}>Start over</button></>
          : 'Sandbox environment: synthetic data, no real messages, payments or accounts.'}
      </div>
      <header className="topbar">
        <span className="brand">OpenSeason</span>
        {s.choices.length > 0 && ctx && (
          <div>
            <label htmlFor="ctx" className="small">Acting as</label>
            <select id="ctx" value={contextKey(ctx)} onChange={(e) => {
              const next = s.choices.find((c) => contextKey(c) === e.target.value);
              if (next) { s.choose(next); if (next.kind !== 'team' && next.kind !== 'club') setTab('home'); }
            }}>
              {s.choices.map((c) => <option key={contextKey(c)} value={contextKey(c)}>{KIND_LABEL[c.kind]}: {c.label}</option>)}
            </select>
          </div>
        )}
        <span className="small">{s.contexts?.person?.display_name}</span>
        <button type="button" className="btn quiet" onClick={s.signOut}>Sign out</button>
      </header>
      <nav className="nav" aria-label="Sections">
        <button type="button" aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}>Home</button>
        {staffTab && <button type="button" aria-current={tab === 'staff' ? 'page' : undefined} onClick={() => setTab('staff')}>Staff Room</button>}
        <button type="button" aria-current={tab === 'messages' ? 'page' : undefined} onClick={() => setTab('messages')}>Messages</button>
      </nav>
      <main id="main" key={ctx ? contextKey(ctx) : 'none'}>
        {!s.contexts && <p className="muted" role="status">Loading…</p>}
        {s.contexts && !ctx && <><p>You're signed in, but not connected to a club, team or family yet.</p><Claim /></>}
        {ctx && tab === 'home' && <Home ctx={ctx} />}
        {ctx && tab === 'staff' && staffTab && <StaffRoom ctx={ctx} />}
        {tab === 'messages' && <Messages />}
      </main>
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
  if (!window.confirm('Start over with fresh sample data? Everything you changed in this sandbox is erased.')) return;
  await (await getSandbox()).reset();
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  window.location.reload();
}

function Home({ ctx }: { ctx: AppContext }) {
  switch (ctx.kind) {
    case 'club': return <><h1>{ctx.label}</h1><ClubHome ctx={ctx} /></>;
    case 'team': return <><h1>{ctx.label}</h1><TeamHome ctx={ctx} /></>;
    case 'fan': return <><h1>Following {ctx.label}</h1><FamilySchedule ctx={ctx} /></>;
    default: return (
      <>
        <h1>{ctx.label}</h1>
        <div className="grid">
          <div style={{ gridColumn: '1 / -1' }}><FamilySchedule ctx={ctx} /></div>
          <FamilyForms athleteId={ctx.athleteId} />
          {ctx.kind === 'family' && <FamilyFees />}
          {ctx.kind === 'family' && <Claim />}
        </div>
      </>
    );
  }
}
