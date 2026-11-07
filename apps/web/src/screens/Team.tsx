import type { ScheduleEvent } from '@openseason/contracts';
import { teamCan, type AppContext } from '@openseason/domain';
import { useState } from 'react';
import { useSession } from '../session';
import { ActionButton, Badge, Show, useLoad, when } from '../ui';

type TeamContext = Extract<AppContext, { kind: 'team' }>;
interface RosterRow { athlete_id: string; first_name: string; last_initial: string; jersey: string | null; status: string; consent: string; age_band: string }

export function TeamHome({ ctx }: { ctx: TeamContext }) {
  const { client } = useSession();
  const [events, reload] = useLoad(() => client.teamSchedule(ctx.teamId, new Date(Date.now() - 86400e3), new Date(Date.now() + 60 * 86400e3)), [client, ctx.teamId]);
  const [roster] = useLoad(() => client.rpc<RosterRow[]>('team_roster', { p_team: ctx.teamId }), [client, ctx.teamId]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="grid">
      <section className="card" aria-labelledby="team-sched" style={{ gridColumn: '1 / -1' }}>
        <h2 id="team-sched">{ctx.label} schedule</h2>
        <Show value={events} empty={(d) => d.length === 0}>
          {(list) => (
            <ul className="list">
              {list.map((e) => (
                <li key={e.id}>
                  <div className="row spread">
                    <div>
                      <h3>{e.title}{e.opponent ? ` vs ${e.opponent}` : ''}</h3>
                      <p className="muted">{when(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</p>
                      {e.rsvp_summary && <p className="small">Going {e.rsvp_summary.yes} · Maybe {e.rsvp_summary.maybe} · Not going {e.rsvp_summary.no} · No reply {e.rsvp_summary.no_response}</p>}
                    </div>
                    <button type="button" className="btn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {e.kind === 'game' ? 'Score' : 'Attendance'}
                    </button>
                  </div>
                  {open === e.id && (e.kind === 'game'
                    ? (teamCan(ctx.role, 'score') ? <Scoring event={e} onSaved={reload} /> : <p className="muted">Scoring is for head coaches and delegated scorekeepers.</p>)
                    : roster.state === 'ready' && <Attendance eventId={e.id} roster={roster.data} />)}
                </li>
              ))}
            </ul>
          )}
        </Show>
      </section>
      <section className="card" aria-labelledby="roster">
        <h2 id="roster">Roster</h2>
        <Show value={roster} empty={(d) => d.length === 0}>
          {(rows) => (
            <ul className="list">
              {rows.map((r) => (
                <li key={r.athlete_id} className="row spread">
                  <span>{r.jersey ? `#${r.jersey} ` : ''}{r.first_name} {r.last_initial}.</span>
                  <span className="row">
                    {r.status !== 'active' && <Badge tone="pending">{r.status}</Badge>}
                    {r.consent !== 'verified' && r.age_band === 'under_13' && <Badge tone="warning">Consent {r.consent}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Show>
      </section>
    </div>
  );
}

function Attendance({ eventId, roster }: { eventId: string; roster: RosterRow[] }) {
  const { client } = useSession();
  const [marked, setMarked] = useState<Record<string, string>>({});
  return (
    <div className="stack" role="group" aria-label="Attendance">
      {roster.filter((r) => r.status === 'active').map((r) => (
        <div key={r.athlete_id} className="row">
          <span style={{ minWidth: 120 }}>{r.first_name} {r.last_initial}.</span>
          {['present', 'late', 'absent', 'excused'].map((s) => (
            <ActionButton key={s} variant={marked[r.athlete_id] === s ? 'primary' : undefined} label={`${r.first_name} ${s}`}
              onRun={async () => { await client.rpc('attendance_record', { p_event: eventId, p_athlete: r.athlete_id, p_status: s }); setMarked({ ...marked, [r.athlete_id]: s }); }}>
              {s}
            </ActionButton>
          ))}
        </div>
      ))}
    </div>
  );
}

function Scoring({ event, onSaved }: { event: ScheduleEvent; onSaved: () => void }) {
  const { client } = useSession();
  const s = event.score;
  const [home, setHome] = useState(s?.home ?? 0);
  const [away, setAway] = useState(s?.away ?? 0);
  const [period, setPeriod] = useState(s?.period ?? 1);
  const save = (status: string) => client.rpc('score_update', {
    // The version guards against two scorekeepers overwriting each other.
    p_event: event.id, p_expected_version: s?.version ?? 1, p_home: home, p_away: away, p_period: period, p_clock: null, p_status: status,
  }).then(onSaved);
  const num = (id: string, label: string, v: number, set: (n: number) => void) => (
    <div className="field" style={{ maxWidth: 120 }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} value={v} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );
  return (
    <div className="stack">
      <div className="row">
        {num(`h-${event.id}`, 'Us', home, setHome)}
        {num(`a-${event.id}`, event.opponent ?? 'Them', away, setAway)}
        {num(`p-${event.id}`, 'Period', period, setPeriod)}
      </div>
      <div className="row">
        <ActionButton onRun={() => save('live')}>Save live score</ActionButton>
        <ActionButton variant="primary" onRun={() => save('final')}>Mark final</ActionButton>
      </div>
    </div>
  );
}
