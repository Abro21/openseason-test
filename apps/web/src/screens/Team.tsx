import type { ScheduleEvent } from '@openseason/contracts';
import { teamCan, type AppContext } from '@openseason/domain';
import { useState } from 'react';
import { useSession } from '../session';
import { StaffDrafts, WaitingOnYou } from '../staff';
import { ActionButton, Badge, DateTile, Empty, PageHeader, Show, useLoad, when } from '../ui';

type TeamContext = Extract<AppContext, { kind: 'team' }>;
interface RosterRow { athlete_id: string; first_name: string; last_initial: string; jersey: string | null; status: string; consent: string; age_band: string }

const ROLE_LABEL: Record<TeamContext['role'], string> = { head_coach: 'Head coach', assistant_coach: 'Assistant coach', scorekeeper: 'Scorekeeper' };

/** A coach's home: the team's schedule, with attendance and scoring one tap away on each event. */
export function TeamSchedule({ ctx }: { ctx: TeamContext }) {
  const { client } = useSession();
  const [events, reload] = useLoad(() => client.teamSchedule(ctx.teamId, new Date(Date.now() - 86400e3), new Date(Date.now() + 60 * 86400e3)), [client, ctx.teamId]);
  const [roster] = useLoad(() => client.rpc<RosterRow[]>('team_roster', { p_team: ctx.teamId }), [client, ctx.teamId]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={ctx.label} subtitle={`${ROLE_LABEL[ctx.role]} · schedule for the next two months`} />
      <WaitingOnYou />
      <section className="card flush" aria-labelledby="team-sched">
        <div className="card-head"><h2 id="team-sched">Coming up</h2></div>
        <Show value={events} empty={(d) => d.length === 0} emptyView={<Empty icon="calendar" title="Nothing scheduled">Games and practices for the next two months show up here.</Empty>}>
          {(list) => {
            const nextPractice = list.find((x) => x.kind === 'practice' && new Date(x.starts_at) > new Date())?.id;
            return (
            <ul className="events">
              {list.map((e) => (
                <li key={e.id} className="event-wrap">
                  <div className="event">
                    <DateTile iso={e.starts_at} />
                    <div className="event-main">
                      <div className="event-title">
                        <span className={`kind-dot ${e.kind === 'game' ? 'game' : ''}`} aria-hidden="true" />
                        {e.title}{e.opponent ? ` vs ${e.opponent}` : ''}
                        {e.score && <Badge tone={e.score.status === 'final' ? 'neutral' : 'info'}>{e.score.status === 'final' ? 'Final' : 'Live'} {e.score.home}–{e.score.away}</Badge>}
                      </div>
                      <p className="muted small">{when(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</p>
                      {e.rsvp_summary && (
                        <p className="rsvp-line small">
                          <span><b>{e.rsvp_summary.yes}</b> going</span>
                          <span><b>{e.rsvp_summary.maybe}</b> maybe</span>
                          <span><b>{e.rsvp_summary.no}</b> out</span>
                          {e.rsvp_summary.no_response > 0 && <span className="warn"><b>{e.rsvp_summary.no_response}</b> no reply</span>}
                        </p>
                      )}
                    </div>
                    <button type="button" className="btn" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {e.kind === 'game' ? 'Score' : 'Attendance'}
                    </button>
                  </div>
                  {teamCan(ctx.role, 'message_team') && (
                    <StaffDrafts compact match={(w) => w.kind === 'attendance_reminder' && w.event_id === e.id}
                      prepare={e.kind === 'game' && e.rsvp_summary && e.rsvp_summary.no_response > 0 ? { kind: 'attendance_reminder', label: 'an RSVP reminder for families who have not answered', target: { event_id: e.id } } : undefined} />
                  )}
                  {e.kind === 'practice' && e.id === nextPractice && teamCan(ctx.role, 'plan_practice') && (
                    <StaffDrafts compact match={(w) => w.kind === 'practice_plan' && w.team_id === ctx.teamId}
                      prepare={{ kind: 'practice_plan', label: 'a plan for this practice', target: { team_id: ctx.teamId } }} />
                  )}
                  {open === e.id && (
                    <div className="event-panel">
                      {e.kind === 'game'
                        ? (teamCan(ctx.role, 'score') ? <Scoring event={e} onSaved={reload} /> : <p className="muted">Scoring is for head coaches and delegated scorekeepers.</p>)
                        : roster.state === 'ready' && <Attendance eventId={e.id} roster={roster.data} />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            );
          }}
        </Show>
      </section>
    </>
  );
}

export function TeamRoster({ ctx }: { ctx: TeamContext }) {
  const { client } = useSession();
  const [roster] = useLoad(() => client.rpc<RosterRow[]>('team_roster', { p_team: ctx.teamId }), [client, ctx.teamId]);
  return (
    <>
      <PageHeader title="Roster" subtitle={ctx.label} />
      <section className="card flush">
        <Show value={roster} empty={(d) => d.length === 0} emptyView={<Empty icon="users" title="No athletes yet">Invite families to add athletes to this team.</Empty>}>
          {(rows) => (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col" className="num">#</th><th scope="col">Athlete</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.athlete_id}>
                      <td className="num muted">{r.jersey ?? '–'}</td>
                      <td><span className="person"><span className="avatar sm" aria-hidden="true">{r.first_name[0]}{r.last_initial}</span>{r.first_name} {r.last_initial}.</span></td>
                      <td>
                        <span className="chips">
                          {r.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="pending">{r.status}</Badge>}
                          {r.consent !== 'verified' && r.age_band === 'under_13' && <Badge tone="warning">Parent consent {r.consent}</Badge>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Show>
      </section>
    </>
  );
}

function Attendance({ eventId, roster }: { eventId: string; roster: RosterRow[] }) {
  const { client } = useSession();
  const [marked, setMarked] = useState<Record<string, string>>({});
  return (
    <div className="attendance" role="group" aria-label="Attendance">
      {roster.filter((r) => r.status === 'active').map((r) => (
        <div key={r.athlete_id} className="attendance-row">
          <span className="person"><span className="avatar sm" aria-hidden="true">{r.first_name[0]}{r.last_initial}</span>{r.first_name} {r.last_initial}.</span>
          <span className="segmented">
          {['present', 'late', 'absent', 'excused'].map((s) => (
            <ActionButton key={s} className="seg" pressed={marked[r.athlete_id] === s} label={`${r.first_name} ${s}`}
              onRun={async () => { await client.rpc('attendance_record', { p_event: eventId, p_athlete: r.athlete_id, p_status: s }); setMarked({ ...marked, [r.athlete_id]: s }); }}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </ActionButton>
          ))}
          </span>
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
    <div className="field score-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} value={v} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );
  return (
    <div className="stack">
      <div className="score-row">
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
