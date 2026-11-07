-- Schedules, RSVPs, attendance, logistics, practice plans, live scoring.

create table public.event_series (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  rule jsonb not null,
  created_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  series_id uuid references public.event_series(id) on delete set null,
  kind text not null check (kind in ('practice','game','tryout','meeting','other')),
  title text not null check (char_length(title) between 1 and 120),
  opponent text check (opponent is null or char_length(opponent) <= 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text check (location is null or char_length(location) <= 200),
  status text not null default 'scheduled' check (status in ('scheduled','changed','cancelled')),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  created_by uuid references public.people(id),
  check (ends_at > starts_at)
);
create index events_team_time on public.events(team_id, starts_at);

create table public.rsvps (
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status text not null check (status in ('yes','no','maybe')),
  responded_by uuid references public.people(id),
  via text not null default 'app' check (via in ('app','sms','email')),
  responded_at timestamptz not null default now(),
  primary key (event_id, athlete_id)
);

create table public.attendance (
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status text not null check (status in ('present','absent','late','excused')),
  recorded_by uuid references public.people(id),
  recorded_at timestamptz not null default now(),
  primary key (event_id, athlete_id)
);

create table public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('snack','carpool','volunteer')),
  label text not null check (char_length(label) between 1 and 80),
  slots int not null default 1 check (slots between 1 and 20),
  created_by uuid references public.people(id)
);

create table public.assignment_signups (
  assignment_id uuid not null references public.event_assignments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (assignment_id, person_id)
);

create table public.practice_plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  focus text not null default '' check (char_length(focus) <= 500),
  version int not null default 1,
  source_prepared_work_id uuid,
  created_by uuid references public.people(id),
  updated_by uuid references public.people(id),
  updated_at timestamptz not null default now()
);

create table public.practice_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.practice_plans(id) on delete cascade,
  position int not null,
  title text not null check (char_length(title) between 1 and 80),
  minutes int not null check (minutes between 1 and 120),
  drill text not null default '' check (char_length(drill) <= 500),
  notes text not null default '' check (char_length(notes) <= 1000),
  rotation jsonb not null default '[]'::jsonb
);

create table public.game_scores (
  event_id uuid primary key references public.events(id) on delete cascade,
  home_score int not null default 0 check (home_score between 0 and 500),
  away_score int not null default 0 check (away_score between 0 and 500),
  period int not null default 1 check (period between 1 and 10),
  clock_seconds int check (clock_seconds is null or clock_seconds between 0 and 7200),
  status text not null default 'not_started' check (status in ('not_started','live','final')),
  version int not null default 1,
  updated_by uuid references public.people(id),
  updated_at timestamptz not null default now()
);

create table public.score_delegations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  granted_by uuid not null references public.people(id),
  revoked_at timestamptz
);

create or replace function app.can_score(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.team_can(p_team, 'score') or exists (
    select 1 from public.score_delegations d where d.team_id = p_team and d.person_id = app.me() and d.revoked_at is null
      and app.is_team_member(p_team))
$$;

alter table public.event_series enable row level security;
alter table public.events enable row level security;
alter table public.rsvps enable row level security;
alter table public.attendance enable row level security;
alter table public.event_assignments enable row level security;
alter table public.assignment_signups enable row level security;
alter table public.practice_plans enable row level security;
alter table public.practice_blocks enable row level security;
alter table public.game_scores enable row level security;
alter table public.score_delegations enable row level security;

grant select on public.events, public.rsvps, public.attendance, public.event_assignments, public.assignment_signups,
  public.practice_plans, public.practice_blocks, public.game_scores, public.score_delegations to authenticated;

create policy events_read on public.events for select to authenticated using (app.can_view_team_calendar(team_id));
create policy rsvps_read on public.rsvps for select to authenticated using (app.is_guardian_of(athlete_id) or app.is_self_athlete(athlete_id)
  or exists (select 1 from public.events e where e.id = event_id and app.team_can(e.team_id, 'view_roster')));
create policy attendance_read on public.attendance for select to authenticated using (app.is_guardian_of(athlete_id) or app.is_self_athlete(athlete_id)
  or exists (select 1 from public.events e where e.id = event_id and app.team_can(e.team_id, 'take_attendance')));
create policy assignments_read on public.event_assignments for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and app.is_team_member(e.team_id)));
create policy signups_read on public.assignment_signups for select to authenticated using (exists (
  select 1 from public.event_assignments a join public.events e on e.id = a.event_id where a.id = assignment_id and app.is_team_member(e.team_id)));
create policy plans_read on public.practice_plans for select to authenticated using (app.team_can(team_id, 'plan_practice'));
create policy blocks_read on public.practice_blocks for select to authenticated using (exists (select 1 from public.practice_plans p where p.id = plan_id and app.team_can(p.team_id, 'plan_practice')));
create policy scores_read on public.game_scores for select to authenticated using (exists (select 1 from public.events e where e.id = event_id and app.can_view_team_calendar(e.team_id)));
create policy delegations_read on public.score_delegations for select to authenticated using (person_id = app.me() or app.team_can(team_id, 'delegate_scoring'));

-- ---------------------------------------------------------------- commands
create or replace function public.event_create(p_team uuid, p_kind text, p_title text, p_starts timestamptz, p_ends timestamptz, p_location text, p_opponent text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_human();
  if not app.team_can(p_team, 'manage_schedule') then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.events(team_id, kind, title, starts_at, ends_at, location, opponent, created_by)
  values (p_team, p_kind, p_title, p_starts, p_ends, p_location, p_opponent, app.me()) returning id into v;
  if p_kind = 'game' then insert into public.game_scores(event_id) values (v); end if;
  return v;
end $$;

-- Weekly series generated in the team's wall-clock time; Postgres applies the
-- correct UTC offset for each date, so DST changes keep 6:00 PM at 6:00 PM.
create or replace function public.event_series_create(p_team uuid, p_kind text, p_title text, p_weekdays int[], p_start_time time,
  p_duration_minutes int, p_from date, p_until date, p_location text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_series uuid; v_tz text; n int;
begin
  perform app.require_human();
  if not app.team_can(p_team, 'manage_schedule') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_until < p_from or p_until - p_from > 366 then raise exception 'series must be within one year'; end if;
  if p_duration_minutes not between 1 and 1440 then raise exception 'duration out of range'; end if;
  select timezone into v_tz from public.teams where id = p_team;
  insert into public.event_series(team_id, rule, created_by) values (p_team, jsonb_build_object('weekdays', p_weekdays, 'start_time', p_start_time, 'duration', p_duration_minutes, 'from', p_from, 'until', p_until, 'tz', v_tz), app.me()) returning id into v_series;
  insert into public.events(team_id, series_id, kind, title, starts_at, ends_at, location, created_by)
  select p_team, v_series, p_kind, p_title, (d::date + p_start_time) at time zone v_tz,
         ((d::date + p_start_time) at time zone v_tz) + make_interval(mins => p_duration_minutes), p_location, app.me()
  from generate_series(p_from::timestamp, p_until::timestamp, interval '1 day') d
  where extract(dow from d)::int = any(p_weekdays);
  get diagnostics n = row_count;
  if n > 200 then raise exception 'a series may not exceed 200 events'; end if;
  return n;
end $$;

-- Ordinary authorized edit with optimistic concurrency. The UI confirms before
-- calling this because families are affected; staff proposals use the
-- schedule_change Pending Action instead.
create or replace function public.event_update(p_event uuid, p_expected_version int, p_starts timestamptz, p_ends timestamptz, p_location text, p_status text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  perform app.require_human();
  select * into e from public.events where id = p_event for update;
  if e.id is null or not app.team_can(e.team_id, 'manage_schedule') then raise exception 'not allowed' using errcode = '42501'; end if;
  if e.version <> p_expected_version then raise exception 'this event changed since you opened it; reload and try again' using errcode = '40001'; end if;
  update public.events set starts_at = p_starts, ends_at = p_ends, location = p_location,
    status = coalesce(p_status, case when p_starts <> e.starts_at or p_ends <> e.ends_at or p_location is distinct from e.location then 'changed' else e.status end),
    version = version + 1, updated_at = now() where id = p_event;
  perform app.audit('event.update', 'event', p_event::text, null, e.team_id);
  return e.version + 1;
end $$;

create or replace function public.rsvp_set(p_event uuid, p_athlete uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events; v_band text;
begin
  perform app.require_human();
  select * into e from public.events where id = p_event;
  select age_band into v_band from public.athletes where id = p_athlete;
  if e.id is null then raise exception 'not found'; end if;
  if not (app.is_guardian_of(p_athlete) or (app.is_self_athlete(p_athlete) and v_band <> 'under_13')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.roster_entries r where r.team_id = e.team_id and r.athlete_id = p_athlete and r.status = 'active') then
    raise exception 'athlete is not active on this team'; end if;
  if e.status = 'cancelled' then raise exception 'event is cancelled'; end if;
  insert into public.rsvps(event_id, athlete_id, status, responded_by, via) values (p_event, p_athlete, p_status, app.me(), 'app')
  on conflict (event_id, athlete_id) do update set status = excluded.status, responded_by = excluded.responded_by, via = 'app', responded_at = now();
end $$;

create or replace function public.attendance_record(p_event uuid, p_athlete uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  perform app.require_human();
  select * into e from public.events where id = p_event;
  if e.id is null or not app.team_can(e.team_id, 'take_attendance') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.roster_entries r where r.team_id = e.team_id and r.athlete_id = p_athlete and r.status <> 'removed') then raise exception 'athlete not on this team'; end if;
  insert into public.attendance(event_id, athlete_id, status, recorded_by) values (p_event, p_athlete, p_status, app.me())
  on conflict (event_id, athlete_id) do update set status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = now();
end $$;

create or replace function public.assignment_create(p_event uuid, p_kind text, p_label text, p_slots int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.events; v uuid;
begin
  perform app.require_human();
  select * into e from public.events where id = p_event;
  if e.id is null or not app.team_can(e.team_id, 'manage_schedule') then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.event_assignments(event_id, kind, label, slots, created_by) values (p_event, p_kind, p_label, p_slots, app.me()) returning id into v;
  return v;
end $$;

create or replace function public.assignment_signup(p_assignment uuid, p_join boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.event_assignments; e public.events; taken int;
begin
  perform app.require_human();
  select * into a from public.event_assignments where id = p_assignment for update;
  select * into e from public.events where id = a.event_id;
  if a.id is null or not (app.is_team_family(e.team_id) or cardinality(app.team_role(e.team_id)) > 0) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_join then
    select count(*) into taken from public.assignment_signups where assignment_id = p_assignment;
    if taken >= a.slots then raise exception 'all spots are taken'; end if;
    insert into public.assignment_signups(assignment_id, person_id, note) values (p_assignment, app.me(), p_note) on conflict do nothing;
  else
    delete from public.assignment_signups where assignment_id = p_assignment and person_id = app.me();
  end if;
end $$;

-- The practice planner's save. Used by the editor directly and when a person
-- saves a staff-prepared plan (an ordinary edit, no artificial approval).
create or replace function public.practice_plan_save(p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p_plan->>'id','')::uuid; v_team uuid := (p_plan->>'team_id')::uuid; cur public.practice_plans; v_ver int; b jsonb; i int := 0;
begin
  perform app.require_human();
  if not app.team_can(v_team, 'plan_practice') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_plan->'blocks') <> 'array' or jsonb_array_length(p_plan->'blocks') > 30 then raise exception 'a plan has 1 to 30 blocks'; end if;
  if v_id is null then
    insert into public.practice_plans(team_id, event_id, title, focus, created_by, updated_by, source_prepared_work_id)
    values (v_team, nullif(p_plan->>'event_id','')::uuid, p_plan->>'title', coalesce(p_plan->>'focus',''), app.me(), app.me(), nullif(p_plan->>'source_prepared_work_id','')::uuid)
    returning id, version into v_id, v_ver;
  else
    select * into cur from public.practice_plans where id = v_id for update;
    if cur.team_id <> v_team then raise exception 'not allowed' using errcode = '42501'; end if;
    if cur.version <> (p_plan->>'version')::int then raise exception 'this plan changed since you opened it; reload and try again' using errcode = '40001'; end if;
    update public.practice_plans set title = p_plan->>'title', focus = coalesce(p_plan->>'focus',''), event_id = nullif(p_plan->>'event_id','')::uuid,
      version = version + 1, updated_by = app.me(), updated_at = now() where id = v_id returning version into v_ver;
    delete from public.practice_blocks where plan_id = v_id;
  end if;
  for b in select * from jsonb_array_elements(p_plan->'blocks') loop
    insert into public.practice_blocks(plan_id, position, title, minutes, drill, notes, rotation)
    values (v_id, i, b->>'title', (b->>'minutes')::int, coalesce(b->>'drill',''), coalesce(b->>'notes',''), coalesce(b->'rotation','[]'::jsonb));
    i := i + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;

create or replace function public.practice_plan_get(p_plan uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'team_id', p.team_id, 'event_id', p.event_id, 'title', p.title, 'focus', p.focus, 'version', p.version, 'updated_at', p.updated_at,
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('title', b.title, 'minutes', b.minutes, 'drill', b.drill, 'notes', b.notes, 'rotation', b.rotation) order by b.position)
                        from public.practice_blocks b where b.plan_id = p.id), '[]'::jsonb))
  from public.practice_plans p where p.id = p_plan
$$;

create or replace function public.team_practice_plans(p_team uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'version', p.version, 'updated_at', p.updated_at,
     'total_minutes', (select coalesce(sum(minutes),0) from public.practice_blocks b where b.plan_id = p.id)) order by p.updated_at desc), '[]'::jsonb)
  from public.practice_plans p where p.team_id = p_team
$$;

create or replace function public.score_update(p_event uuid, p_expected_version int, p_home int, p_away int, p_period int, p_clock int, p_status text) returns int
language plpgsql security definer set search_path = '' as $$
declare e public.events; s public.game_scores;
begin
  perform app.require_human();
  select * into e from public.events where id = p_event;
  if e.id is null or e.kind <> 'game' or not app.can_score(e.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.game_scores where event_id = p_event for update;
  if s.version <> p_expected_version then raise exception 'score changed on another device; reload' using errcode = '40001'; end if;
  if s.status = 'final' and p_status <> 'final' and not app.team_can(e.team_id, 'delegate_scoring') then raise exception 'final scores can only be reopened by the head coach'; end if;
  update public.game_scores set home_score = p_home, away_score = p_away, period = p_period, clock_seconds = p_clock, status = p_status,
    version = version + 1, updated_by = app.me(), updated_at = now() where event_id = p_event;
  if p_status = 'final' and s.status <> 'final' then perform app.audit('score.final', 'event', p_event::text, null, e.team_id); end if;
  return s.version + 1;
end $$;

create or replace function public.score_delegate(p_team uuid, p_person uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_human();
  if not app.team_can(p_team, 'delegate_scoring') then raise exception 'not allowed' using errcode = '42501'; end if;
  -- delegate must be an affiliated adult: staff or an active guardian on this team
  if not exists (select 1 from public.team_people(p_team) tp where tp.person_id = p_person) then raise exception 'scoring can only be delegated to a coach or guardian on this team'; end if;
  insert into public.score_delegations(team_id, person_id, granted_by) values (p_team, p_person, app.me()) returning id into v;
  perform app.audit('score.delegate', 'person', p_person::text, null, p_team);
  return v;
end $$;

create or replace function public.score_delegation_revoke(p_delegation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.score_delegations;
begin
  perform app.require_human();
  select * into d from public.score_delegations where id = p_delegation for update;
  if d.id is null or not app.team_can(d.team_id, 'delegate_scoring') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.score_delegations set revoked_at = now() where id = p_delegation;
end $$;

-- ---------------------------------------------------------------- reads
-- Schedule for one team. Family members see their own athletes' RSVPs; staff
-- see counts; fans see only time, place, status and score.
create or replace function public.team_schedule(p_team uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare is_staff boolean := app.team_can(p_team, 'view_roster'); is_member boolean := app.is_team_member(p_team);
begin
  if not app.can_view_team_calendar(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'starts_at') from (
    select jsonb_build_object(
      'id', e.id, 'team_id', e.team_id, 'kind', e.kind, 'title', e.title, 'opponent', e.opponent,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status, 'version', e.version,
      'location', case when is_member then e.location else null end,
      'score', (select jsonb_build_object('home', s.home_score, 'away', s.away_score, 'period', s.period, 'clock', s.clock_seconds, 'status', s.status, 'version', s.version) from public.game_scores s where s.event_id = e.id),
      'my_rsvps', case when is_member then coalesce((select jsonb_agg(jsonb_build_object('athlete_id', r.athlete_id, 'athlete', a.first_name, 'status', rv.status))
            from public.roster_entries r join public.athletes a on a.id = r.athlete_id
            left join public.rsvps rv on rv.event_id = e.id and rv.athlete_id = r.athlete_id
            where r.team_id = e.team_id and r.status = 'active' and (app.is_guardian_of(r.athlete_id) or app.is_self_athlete(r.athlete_id))), '[]'::jsonb) else '[]'::jsonb end,
      'rsvp_summary', case when is_staff then (select jsonb_build_object(
            'yes', count(*) filter (where rv.status = 'yes'), 'no', count(*) filter (where rv.status = 'no'),
            'maybe', count(*) filter (where rv.status = 'maybe'), 'no_response', count(*) filter (where rv.status is null))
            from public.roster_entries r left join public.rsvps rv on rv.event_id = e.id and rv.athlete_id = r.athlete_id
            where r.team_id = e.team_id and r.status = 'active') else null end
    ) x
    from public.events e where e.team_id = p_team and e.starts_at >= p_from and e.starts_at < p_to
  ) q), '[]'::jsonb);
end $$;

create or replace function public.event_detail(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.events; is_staff boolean; is_member boolean;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or not app.can_view_team_calendar(e.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  is_staff := app.team_can(e.team_id, 'take_attendance'); is_member := app.is_team_member(e.team_id);
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'team_id', e.team_id, 'kind', e.kind, 'title', e.title, 'opponent', e.opponent, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
       'location', case when is_member then e.location end, 'status', e.status, 'version', e.version),
    'can_score', app.can_score(e.team_id), 'can_manage', app.team_can(e.team_id, 'manage_schedule'), 'can_take_attendance', is_staff,
    'score', (select to_jsonb(s) - 'updated_by' from public.game_scores s where s.event_id = e.id),
    'assignments', case when is_member then coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'label', a.label, 'slots', a.slots,
        'taken', (select count(*) from public.assignment_signups s where s.assignment_id = a.id),
        'mine', exists (select 1 from public.assignment_signups s where s.assignment_id = a.id and s.person_id = app.me()),
        'names', (select coalesce(jsonb_agg(p.display_name), '[]'::jsonb) from public.assignment_signups s join public.people p on p.id = s.person_id where s.assignment_id = a.id)))
        from public.event_assignments a where a.event_id = e.id), '[]'::jsonb) else '[]'::jsonb end,
    'roster', case when is_staff then coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'name', a.first_name || ' ' || a.last_initial || '.',
        'rsvp', rv.status, 'attendance', at.status) order by a.first_name)
        from public.roster_entries r join public.athletes a on a.id = r.athlete_id
        left join public.rsvps rv on rv.event_id = e.id and rv.athlete_id = a.id
        left join public.attendance at on at.event_id = e.id and at.athlete_id = a.id
        where r.team_id = e.team_id and r.status = 'active'), '[]'::jsonb) else null end
  );
end $$;
