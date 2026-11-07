-- Function bodies reference functions defined later in this file.
set check_function_bodies = off;

-- Staff Room: threads, structured prepared work, Pending Actions with
-- approval, revalidation, idempotent execution and attempt history.
--
-- Staff act for the signed-in person, inside that person's permissions. The
-- staff runtime calls these RPCs with the person's session plus os_actor=agent;
-- it can read, prepare and propose, never approve or run human commands.

create table public.staff_role_titles (
  person_id uuid not null references public.people(id) on delete cascade,
  role_id text not null check (role_id in ('player_development','practice_prep','dobo','admin')),
  display_title text not null check (char_length(display_title) between 1 and 60),
  primary key (person_id, role_id)
);

create table public.staff_threads (
  id uuid primary key default gen_random_uuid(),
  owner_person_id uuid not null references public.people(id) on delete cascade,
  role_id text not null check (role_id in ('player_development','practice_prep','dobo','admin')),
  context jsonb not null default '{}'::jsonb,
  title text not null default 'Conversation' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.staff_threads(id) on delete cascade,
  author text not null check (author in ('person','staff','system')),
  body text not null check (char_length(body) between 1 and 8000),
  input_mode text check (input_mode in ('typed','dictated')),
  status text not null default 'complete' check (status in ('complete','interrupted','error')),
  prepared_work_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index staff_messages_thread_time on public.staff_messages(thread_id, created_at desc);

create table public.prepared_work (
  id uuid primary key default gen_random_uuid(),
  owner_person_id uuid not null references public.people(id) on delete cascade,
  thread_id uuid references public.staff_threads(id) on delete set null,
  role_id text not null check (role_id in ('player_development','practice_prep','dobo','admin')),
  kind text not null check (kind in ('practice_plan','rotation','announcement','attendance_reminder','fee_reminder','certification_nudge','player_feedback')),
  org_id uuid references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  title text not null,
  summary text not null default '',
  artifact jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'in_review' check (status in ('in_review','needs_refresh','proposed','saved','dismissed','done')),
  revision int not null default 1,
  dedupe_key text not null,
  created_via text not null check (created_via in ('agent','person')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index prepared_work_dedupe on public.prepared_work(owner_person_id, dedupe_key) where status not in ('dismissed','done','saved');

create table public.staff_jobs (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people(id) on delete cascade,
  trigger text not null,
  ran_at timestamptz not null default now(),
  created int not null default 0
);

create table public.action_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.people(id),
  idempotency_key text not null unique,
  results jsonb,
  created_at timestamptz not null default now()
);

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  schema_version int not null default 1,
  kind text not null check (kind in ('send_message','schedule_change','refund','share_player_feedback')),
  prepared_work_id uuid references public.prepared_work(id) on delete set null,
  owner_person_id uuid not null references public.people(id),
  requested_via text not null check (requested_via in ('agent','person')),
  org_id uuid references public.organizations(id),
  team_id uuid references public.teams(id),
  payload jsonb not null,
  payload_hash text not null,
  revision int not null default 1,
  dependencies jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'in_review' check (status in ('proposed','in_review','needs_refresh','approved','rejected','ended','queued','processing','succeeded','failed','uncertain')),
  status_reason text,
  approved_by uuid references public.people(id),
  approved_revision int,
  approved_hash text,
  approval_key text unique,
  batch_id uuid references public.action_batches(id),
  rejected_reason text,
  outcome jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pending_actions_owner on public.pending_actions(owner_person_id, status);

create table public.action_attempts (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.pending_actions(id) on delete cascade,
  attempt int not null,
  at timestamptz not null default now(),
  outcome text not null,
  detail text
);

create unique index messages_one_per_action_recipient on public.messages(source_action_id, conversation_id) where source_action_id is not null;

alter table public.staff_role_titles enable row level security;
alter table public.staff_threads enable row level security;
alter table public.staff_messages enable row level security;
alter table public.prepared_work enable row level security;
alter table public.staff_jobs enable row level security;
alter table public.action_batches enable row level security;
alter table public.pending_actions enable row level security;
alter table public.action_attempts enable row level security;

grant select on public.staff_role_titles, public.staff_threads, public.staff_messages, public.prepared_work, public.pending_actions, public.action_attempts to authenticated;
create policy titles_own on public.staff_role_titles for select to authenticated using (person_id = app.me());
create policy threads_own on public.staff_threads for select to authenticated using (owner_person_id = app.me());
create policy staff_messages_own on public.staff_messages for select to authenticated using (exists (select 1 from public.staff_threads t where t.id = thread_id and t.owner_person_id = app.me()));
create policy prepared_own on public.prepared_work for select to authenticated using (owner_person_id = app.me());
create policy actions_own on public.pending_actions for select to authenticated using (owner_person_id = app.me());
create policy attempts_own on public.action_attempts for select to authenticated using (exists (select 1 from public.pending_actions a where a.id = action_id and a.owner_person_id = app.me()));

create or replace function app.require_staff_entitlement() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.staff_entitled(app.me()) then
    raise exception 'staff are not active on your plan; your free tools still work' using errcode = '42501';
  end if;
end $$;

-- Built-in sha256 (Postgres 11+) so no extension or search_path is needed.
create or replace function app.hash(p jsonb) returns text language sql immutable set search_path = '' as $$ select encode(pg_catalog.sha256(pg_catalog.convert_to(p::text, 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------- titles and threads
create or replace function public.staff_title_set(p_role text, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  if nullif(trim(p_title), '') is null then delete from public.staff_role_titles where person_id = app.me() and role_id = p_role; return; end if;
  insert into public.staff_role_titles(person_id, role_id, display_title) values (app.me(), p_role, trim(p_title))
  on conflict (person_id, role_id) do update set display_title = excluded.display_title;
end $$;

create or replace function public.staff_thread_open(p_role text, p_context jsonb, p_title text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_me();
  select id into v from public.staff_threads where owner_person_id = app.me() and role_id = p_role and context = coalesce(p_context, '{}'::jsonb) order by updated_at desc limit 1;
  if v is null then
    insert into public.staff_threads(owner_person_id, role_id, context, title) values (app.me(), p_role, coalesce(p_context, '{}'::jsonb), coalesce(p_title, 'Conversation')) returning id into v;
  end if;
  return v;
end $$;

create or replace function public.staff_thread_messages(p_thread uuid, p_before timestamptz default null, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb; more boolean;
begin
  if not exists (select 1 from public.staff_threads t where t.id = p_thread and t.owner_person_id = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) into rows from (
    select jsonb_build_object('id', m.id, 'author', m.author, 'body', m.body, 'status', m.status, 'input_mode', m.input_mode, 'prepared_work_id', m.prepared_work_id, 'created_at', m.created_at) x
    from public.staff_messages m where m.thread_id = p_thread and (p_before is null or m.created_at < p_before)
    order by m.created_at desc limit least(greatest(p_limit,1),100)) q;
  select count(*) > least(greatest(p_limit,1),100) into more from public.staff_messages m where m.thread_id = p_thread and (p_before is null or m.created_at < p_before);
  return jsonb_build_object('messages', rows, 'has_more', more);
end $$;

-- Person's own message (typed or OS-dictated text, editable before send).
create or replace function public.staff_message_post(p_thread uuid, p_body text, p_input_mode text default 'typed') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_human();
  perform app.rate_limit('staff_message', 120, interval '1 hour');
  if not exists (select 1 from public.staff_threads t where t.id = p_thread and t.owner_person_id = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.staff_messages(thread_id, author, body, input_mode) values (p_thread, 'person', p_body, p_input_mode) returning id into v;
  update public.staff_threads set updated_at = now() where id = p_thread;
  return v;
end $$;

-- Staff reply, written by the staff runtime. Interrupted/error replies are
-- persisted honestly rather than dropped.
create or replace function public.staff_message_reply(p_thread uuid, p_body text, p_status text, p_prepared_work uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_me();
  if app.actor_kind() <> 'agent' then raise exception 'only the staff runtime writes staff replies' using errcode = '42501'; end if;
  perform app.require_staff_entitlement();
  if not exists (select 1 from public.staff_threads t where t.id = p_thread and t.owner_person_id = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_prepared_work is not null and not exists (select 1 from public.prepared_work w where w.id = p_prepared_work and w.owner_person_id = app.me()) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.staff_messages(thread_id, author, body, status, prepared_work_id) values (p_thread, 'staff', p_body, p_status, p_prepared_work) returning id into v;
  update public.staff_threads set updated_at = now() where id = p_thread;
  return v;
end $$;

-- ---------------------------------------------------------------- preparation
-- Each preparer reads only what the acting person may read (all checks use
-- app.* permission helpers bound to auth.uid()). Sources record what was read
-- and its version so staleness can be detected before approval.
create or replace function public.staff_prepare(p_kind text, p_target jsonb, p_thread uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_me(); v uuid; v_team uuid; v_org uuid; v_event public.events; v_team_row public.teams;
  v_art jsonb; v_sources jsonb := '[]'::jsonb; v_title text; v_summary text; v_role text; v_key text; v_recipients jsonb; v_prev jsonb; v_athlete public.athletes; v_conv uuid;
begin
  perform app.require_staff_entitlement();
  if p_thread is not null and not exists (select 1 from public.staff_threads t where t.id = p_thread and t.owner_person_id = v_me) then raise exception 'not allowed' using errcode = '42501'; end if;
  -- budget: at most 30 prepared items per person per day
  if (select count(*) from public.prepared_work where owner_person_id = v_me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'staff preparation budget reached for today' using errcode = '53400'; end if;

  if p_kind = 'practice_plan' then
    v_team := (p_target->>'team_id')::uuid;
    if not app.team_can(v_team, 'plan_practice') then raise exception 'not allowed' using errcode = '42501'; end if;
    select * into v_team_row from public.teams where id = v_team;
    select * into v_event from public.events where team_id = v_team and kind = 'practice' and starts_at > now() and status <> 'cancelled' order by starts_at limit 1;
    select public.practice_plan_get(p.id) into v_prev from public.practice_plans p where p.team_id = v_team order by p.updated_at desc limit 1;
    v_role := 'practice_prep'; v_key := 'practice_plan:' || v_team || ':' || coalesce(v_event.id::text, 'next');
    v_title := 'Practice plan' || coalesce(' for ' || to_char(v_event.starts_at at time zone v_team_row.timezone, 'Dy Mon DD'), '');
    v_art := jsonb_build_object('team_id', v_team, 'event_id', v_event.id, 'title', v_title,
      'focus', coalesce(nullif(p_target->>'focus', ''), 'Ball movement and defensive communication'),
      'blocks', jsonb_build_array(
        jsonb_build_object('title', 'Dynamic warm-up', 'minutes', 10, 'drill', 'Lines: high knees, carioca, closeouts', 'notes', '', 'rotation', '[]'::jsonb),
        jsonb_build_object('title', 'Ball handling', 'minutes', 15, 'drill', 'Two-ball stationary series', 'notes', '', 'rotation', '[]'::jsonb),
        jsonb_build_object('title', 'Shell defense', 'minutes', 20, 'drill', '4-on-4 shell, talk on every pass', 'notes', '', 'rotation', '[]'::jsonb),
        jsonb_build_object('title', 'Small-sided games', 'minutes', 20, 'drill', '3-on-3 advantage', 'notes', '', 'rotation', '[]'::jsonb),
        jsonb_build_object('title', 'Free throws and cool-down', 'minutes', 10, 'drill', 'Pairs, 10 makes each', 'notes', '', 'rotation', '[]'::jsonb)));
    v_summary := '5 blocks, 75 minutes' || case when v_prev is not null then ', building on "' || (v_prev->>'title') || '"' else '' end;
    v_sources := jsonb_build_array(jsonb_build_object('type','team','id',v_team,'version',v_team_row.roster_version,'label','Roster'),
      jsonb_build_object('type','event','id',v_event.id,'version',v_event.version,'label', coalesce(v_event.title,'No upcoming practice')));
    if v_prev is not null then v_sources := v_sources || jsonb_build_array(jsonb_build_object('type','practice_plan','id',v_prev->>'id','version',(v_prev->>'version')::int,'label','Last plan')); end if;
    v_org := v_team_row.org_id;

  elsif p_kind = 'attendance_reminder' then
    select * into v_event from public.events where id = (p_target->>'event_id')::uuid;
    v_team := v_event.team_id;
    if v_event.id is null or not app.team_can(v_team, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
    select * into v_team_row from public.teams where id = v_team;
    select coalesce(jsonb_agg(distinct jsonb_build_object('person_id', g.guardian_person_id, 'name', p.display_name)), '[]'::jsonb) into v_recipients
      from public.roster_entries r join public.guardianships g on g.athlete_id = r.athlete_id and g.status = 'active'
      join public.people p on p.id = g.guardian_person_id
      where r.team_id = v_team and r.status = 'active' and not exists (select 1 from public.rsvps rv where rv.event_id = v_event.id and rv.athlete_id = r.athlete_id);
    v_role := 'admin'; v_key := 'attendance_reminder:' || v_event.id;
    v_title := 'RSVP reminder: ' || v_event.title;
    v_art := jsonb_build_object('audience', 'individuals', 'team_id', v_team, 'title', 'Please RSVP',
      'body', 'Please RSVP for ' || v_event.title || ' on ' || to_char(v_event.starts_at at time zone v_team_row.timezone, 'Dy Mon DD "at" HH12:MI AM') || '. Open the schedule in OpenSeason to reply.',
      'recipients', v_recipients, 'event_id', v_event.id);
    v_summary := jsonb_array_length(v_recipients) || ' families have not replied';
    v_sources := jsonb_build_array(jsonb_build_object('type','event','id',v_event.id,'version',v_event.version,'label',v_event.title),
      jsonb_build_object('type','team','id',v_team,'version',v_team_row.roster_version,'label','Roster'));
    v_org := v_team_row.org_id;

  elsif p_kind = 'fee_reminder' then
    v_org := (p_target->>'org_id')::uuid;
    if not app.has_org_perm(v_org, 'manage_finance') then raise exception 'not allowed' using errcode = '42501'; end if;
    -- recipients only; the shared text never contains amounts or other families' details
    select coalesce(jsonb_agg(distinct jsonb_build_object('person_id', g.guardian_person_id, 'name', p.display_name)), '[]'::jsonb) into v_recipients
      from public.installments n join public.invoices i on i.id = n.invoice_id
      join public.guardianships g on g.athlete_id = i.athlete_id and g.status = 'active' join public.people p on p.id = g.guardian_person_id
      where i.org_id = v_org and n.status = 'open' and n.due_on < current_date;
    v_role := 'admin'; v_key := 'fee_reminder:' || v_org || ':' || current_date;
    v_title := 'Overdue balance reminders';
    v_art := jsonb_build_object('audience', 'individuals', 'org_id', v_org, 'title', 'Balance reminder',
      'body', 'Hi, you have an overdue balance with ' || (select name from public.organizations where id = v_org) || '. You can review and pay it under Fees in OpenSeason. Reply here if you need a payment plan.',
      'recipients', v_recipients);
    v_summary := jsonb_array_length(v_recipients) || ' families with an overdue installment';
    v_sources := jsonb_build_array(jsonb_build_object('type','org_finance','id',v_org,'version',(select coalesce(sum(i.version),0) from public.invoices i where i.org_id = v_org),'label','Invoices'));

  elsif p_kind = 'certification_nudge' then
    v_org := (p_target->>'org_id')::uuid;
    if not app.has_org_perm(v_org, 'manage_compliance') then raise exception 'not allowed' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(distinct jsonb_build_object('person_id', p.id, 'name', p.display_name)), '[]'::jsonb) into v_recipients
      from public.certifications c join public.people p on p.id = c.person_id
      where c.org_id = v_org and (c.status in ('missing','expired') or c.expires_on < current_date + 30);
    v_role := 'dobo'; v_key := 'certification_nudge:' || v_org || ':' || current_date;
    v_title := 'Certification reminders';
    v_art := jsonb_build_object('audience', 'individuals', 'org_id', v_org, 'title', 'Certification reminder',
      'body', 'Hi, one of your coaching certifications is missing or expires soon. Please upload a current copy in OpenSeason so you stay cleared to coach.',
      'recipients', v_recipients);
    v_summary := jsonb_array_length(v_recipients) || ' staff with a gap or upcoming expiry';
    v_sources := jsonb_build_array(jsonb_build_object('type','org_certifications','id',v_org,'version',(select count(*) from public.certifications where org_id = v_org),'label','Certifications'));

  elsif p_kind = 'player_feedback' then
    v_team := (p_target->>'team_id')::uuid;
    select * into v_athlete from public.athletes where id = (p_target->>'athlete_id')::uuid;
    if not (app.team_can(v_team, 'plan_practice') and exists (select 1 from public.roster_entries r where r.team_id = v_team and r.athlete_id = v_athlete.id and r.status = 'active')) then
      raise exception 'not allowed' using errcode = '42501'; end if;
    select * into v_team_row from public.teams where id = v_team;
    select coalesce(jsonb_agg(jsonb_build_object('person_id', g.guardian_person_id, 'name', p.display_name)), '[]'::jsonb) into v_recipients
      from public.guardianships g join public.people p on p.id = g.guardian_person_id where g.athlete_id = v_athlete.id and g.status = 'active';
    v_role := 'player_development'; v_key := 'player_feedback:' || v_athlete.id || ':' || current_date;
    v_title := 'Feedback draft for ' || v_athlete.first_name;
    v_art := jsonb_build_object('audience', 'individuals', 'team_id', v_team, 'athlete_id', v_athlete.id, 'title', 'Feedback for ' || v_athlete.first_name,
      'strengths', 'Effort and attention at practice.', 'focus', 'Keep working on weak-hand finishes.',
      'body', v_athlete.first_name || ' has been working hard. Strength: effort and attention at practice. Next focus: weak-hand finishes. Attended '
        || (select count(*) from public.attendance a join public.events e on e.id = a.event_id where a.athlete_id = v_athlete.id and e.team_id = v_team and a.status in ('present','late'))
        || ' sessions recently.',
      'recipients', v_recipients);
    v_summary := 'Private draft. Nothing is shared until you approve it.';
    v_sources := jsonb_build_array(jsonb_build_object('type','attendance','id',v_athlete.id,'version',(select count(*) from public.attendance a where a.athlete_id = v_athlete.id),'label','Attendance'),
      jsonb_build_object('type','team','id',v_team,'version',v_team_row.roster_version,'label','Roster'));
    v_org := v_team_row.org_id;

  elsif p_kind = 'announcement' then
    v_team := (p_target->>'team_id')::uuid;
    if not app.team_can(v_team, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
    select * into v_team_row from public.teams where id = v_team;
    -- Create the team conversation first: a row inserted inside the same
    -- statement would not be visible to conversation_audience.
    v_conv := app.team_conversation(v_team);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_recipients from unnest(app.conversation_audience(v_conv)) pid
      join public.people p on p.id = pid cross join lateral (select jsonb_build_object('person_id', p.id, 'name', p.display_name) x) l where p.id <> v_me;
    v_role := 'admin'; v_key := 'announcement:' || v_team || ':' || current_date;
    v_title := 'This week for ' || v_team_row.name;
    v_art := jsonb_build_object('audience', 'team', 'team_id', v_team, 'title', 'This week',
      'body', coalesce((select string_agg(e.title || ': ' || to_char(e.starts_at at time zone v_team_row.timezone, 'Dy Mon DD HH12:MI AM') || coalesce(' at ' || e.location, ''), E'\n' order by e.starts_at)
                        from public.events e where e.team_id = v_team and e.starts_at between now() and now() + interval '7 days' and e.status <> 'cancelled'), 'No events this week.'),
      'recipients', v_recipients);
    v_summary := 'Team announcement with the next 7 days';
    v_sources := jsonb_build_array(jsonb_build_object('type','team','id',v_team,'version',v_team_row.roster_version,'label','Roster'),
      jsonb_build_object('type','team_schedule','id',v_team,'version',(select coalesce(sum(version),0) from public.events where team_id = v_team),'label','Schedule'));
    v_org := v_team_row.org_id;
  else
    raise exception 'unknown work kind';
  end if;

  select id into v from public.prepared_work where owner_person_id = v_me and dedupe_key = v_key and status not in ('dismissed','done','saved');
  if v is not null then return v; end if;  -- deduplicated
  insert into public.prepared_work(owner_person_id, thread_id, role_id, kind, org_id, team_id, title, summary, artifact, sources, dedupe_key, created_via)
  values (v_me, p_thread, v_role, p_kind, v_org, v_team, v_title, v_summary, v_art, v_sources, v_key, app.actor_kind()) returning id into v;
  perform app.audit('prepared_work.create', 'prepared_work', v::text, v_org, v_team, null, jsonb_build_object('kind', p_kind));
  return v;
end $$;

-- Proactive triggers: explicit, budgeted, deduplicated. Prepares work only.
create or replace function public.staff_run_triggers() returns int
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_me(); n int := 0; r record;
begin
  perform app.require_staff_entitlement();
  if exists (select 1 from public.staff_jobs where person_id = v_me and trigger = 'daily' and ran_at > now() - interval '1 hour') then return 0; end if;
  for r in select e.id from public.events e where app.team_can(e.team_id, 'message_team') and e.starts_at between now() and now() + interval '3 days' and e.status <> 'cancelled'
           and exists (select 1 from public.roster_entries re where re.team_id = e.team_id and re.status = 'active' and not exists (select 1 from public.rsvps rv where rv.event_id = e.id and rv.athlete_id = re.athlete_id))
           limit 3 loop
    perform public.staff_prepare('attendance_reminder', jsonb_build_object('event_id', r.id)); n := n + 1;
  end loop;
  for r in select distinct t.id from public.teams t where app.team_can(t.id, 'plan_practice') and 'head_coach' = any(app.team_role(t.id)) limit 3 loop
    perform public.staff_prepare('practice_plan', jsonb_build_object('team_id', r.id)); n := n + 1;
  end loop;
  for r in select distinct g.org_id from public.org_grants g where g.person_id = v_me and g.revoked_at is null loop
    if app.has_org_perm(r.org_id, 'manage_finance') and exists (select 1 from public.installments n2 join public.invoices i on i.id = n2.invoice_id where i.org_id = r.org_id and n2.status = 'open' and n2.due_on < current_date) then
      perform public.staff_prepare('fee_reminder', jsonb_build_object('org_id', r.org_id)); n := n + 1; end if;
    if app.has_org_perm(r.org_id, 'manage_compliance') and exists (select 1 from public.certifications c where c.org_id = r.org_id and (c.status in ('missing','expired') or c.expires_on < current_date + 30)) then
      perform public.staff_prepare('certification_nudge', jsonb_build_object('org_id', r.org_id)); n := n + 1; end if;
  end loop;
  insert into public.staff_jobs(person_id, trigger, created) values (v_me, 'daily', n);
  return n;
end $$;

-- Current version of each recorded source. Used to flag stale work.
create or replace function app.source_version(p_source jsonb) returns bigint
language sql stable security definer set search_path = '' as $$
  select case p_source->>'type'
    when 'team' then (select roster_version::bigint from public.teams where id = (p_source->>'id')::uuid)
    when 'event' then (select version::bigint from public.events where id = nullif(p_source->>'id','')::uuid)
    when 'practice_plan' then (select version::bigint from public.practice_plans where id = (p_source->>'id')::uuid)
    when 'org_finance' then (select coalesce(sum(version),0)::bigint from public.invoices where org_id = (p_source->>'id')::uuid)
    when 'org_certifications' then (select count(*)::bigint from public.certifications where org_id = (p_source->>'id')::uuid)
    when 'attendance' then (select count(*)::bigint from public.attendance where athlete_id = (p_source->>'id')::uuid)
    when 'team_schedule' then (select coalesce(sum(version),0)::bigint from public.events where team_id = (p_source->>'id')::uuid)
  end
$$;

create or replace function app.sources_stale(p_sources jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(p_sources) s where s->>'id' is not null and app.source_version(s) is distinct from (s->>'version')::bigint)
$$;

create or replace function public.staff_room() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'entitlement', public.my_entitlement(),
    'titles', coalesce((select jsonb_object_agg(role_id, display_title) from public.staff_role_titles where person_id = app.me()), '{}'::jsonb),
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'role_id', w.role_id, 'title', w.title, 'summary', w.summary, 'status', w.status,
         'stale', app.sources_stale(w.sources), 'team_id', w.team_id, 'org_id', w.org_id, 'thread_id', w.thread_id, 'updated_at', w.updated_at,
         'action', (select jsonb_build_object('id', a.id, 'status', a.status, 'revision', a.revision) from public.pending_actions a where a.prepared_work_id = w.id order by a.created_at desc limit 1))
         order by w.updated_at desc) from public.prepared_work w where w.owner_person_id = app.me() and w.status not in ('dismissed')), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'summary', a.summary, 'revision', a.revision, 'prepared_work_id', a.prepared_work_id, 'updated_at', a.updated_at) order by a.updated_at desc)
         from public.pending_actions a where a.owner_person_id = app.me() and a.prepared_work_id is null), '[]'::jsonb)
  )
$$;

create or replace function public.prepared_work_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'kind', w.kind, 'role_id', w.role_id, 'title', w.title, 'summary', w.summary, 'artifact', w.artifact, 'status', w.status,
    'revision', w.revision, 'team_id', w.team_id, 'org_id', w.org_id, 'thread_id', w.thread_id, 'created_via', w.created_via, 'updated_at', w.updated_at,
    'sources', (select jsonb_agg(s || jsonb_build_object('current_version', app.source_version(s), 'changed', app.source_version(s) is distinct from (s->>'version')::bigint)) from jsonb_array_elements(w.sources) s),
    'action', (select public.action_get(a.id) from public.pending_actions a where a.prepared_work_id = w.id order by a.created_at desc limit 1))
  from public.prepared_work w where w.id = p_id and w.owner_person_id = app.me()
$$;

-- Editing the artifact in its normal editor. Any change to a linked open
-- action's material payload invalidates prior review.
create or replace function public.prepared_work_update(p_id uuid, p_expected_revision int, p_artifact jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare w public.prepared_work; a public.pending_actions;
begin
  perform app.require_me();
  select * into w from public.prepared_work where id = p_id for update;
  if w.id is null or w.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if w.revision <> p_expected_revision then raise exception 'this draft changed since you opened it; reload' using errcode = '40001'; end if;
  if w.status in ('done','dismissed','saved') then raise exception 'this work is closed'; end if;
  -- recipients can only shrink through editing; they can never be added here
  if p_artifact ? 'recipients' and exists (select 1 from jsonb_array_elements(p_artifact->'recipients') r
       where not exists (select 1 from jsonb_array_elements(w.artifact->'recipients') o where o->>'person_id' = r->>'person_id')) then
    raise exception 'recipients can be removed but not added to prepared work' using errcode = '42501'; end if;
  update public.prepared_work set artifact = p_artifact, revision = revision + 1, updated_at = now(),
    status = case when status = 'needs_refresh' then 'in_review' else status end where id = p_id;
  select * into a from public.pending_actions where prepared_work_id = p_id and status in ('proposed','in_review','needs_refresh') order by created_at desc limit 1 for update;
  if a.id is not null then
    perform app.action_set_payload(a.id, app.payload_from_work(w.kind, p_artifact));
  end if;
  return w.revision + 1;
end $$;

create or replace function public.prepared_work_dismiss(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_me();
  update public.prepared_work set status = 'dismissed', updated_at = now() where id = p_id and owner_person_id = app.me();
  update public.pending_actions set status = 'ended', updated_at = now(), version = version + 1 where prepared_work_id = p_id and status in ('proposed','in_review','needs_refresh','rejected');
end $$;

-- Saving a prepared practice plan is an ordinary edit through the planner.
create or replace function public.prepared_work_mark_saved(p_id uuid, p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  if not exists (select 1 from public.practice_plans p where p.id = p_plan and p.source_prepared_work_id = p_id) then raise exception 'plan was not saved from this draft'; end if;
  update public.prepared_work set status = 'saved', updated_at = now() where id = p_id and owner_person_id = app.me() and kind in ('practice_plan','rotation');
end $$;

-- ---------------------------------------------------------------- Pending Actions
create or replace function app.payload_from_work(p_kind text, p_art jsonb) returns jsonb
language sql immutable as $$
  select case
    when p_kind = 'player_feedback' then jsonb_build_object('athlete_id', p_art->'athlete_id', 'team_id', p_art->'team_id', 'body', p_art->'body', 'title', p_art->'title',
         'recipients', coalesce((select jsonb_agg(r->'person_id' order by r->>'person_id') from jsonb_array_elements(p_art->'recipients') r), '[]'::jsonb))
    else jsonb_build_object('audience', p_art->'audience', 'team_id', p_art->'team_id', 'org_id', p_art->'org_id', 'title', p_art->'title', 'body', p_art->'body', 'event_id', p_art->'event_id',
         'recipients', coalesce((select jsonb_agg(r->'person_id' order by r->>'person_id') from jsonb_array_elements(p_art->'recipients') r), '[]'::jsonb),
         'purpose', to_jsonb(p_kind))
  end
$$;

create or replace function app.action_summary(p_kind text, p_payload jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'send_message' then jsonb_build_object('effect',
        case when p_payload->>'audience' = 'team' then 'Post to the team conversation and notify ' || jsonb_array_length(p_payload->'recipients') || ' people'
             else 'Send a private message to each of ' || jsonb_array_length(p_payload->'recipients') || ' people' end,
        'title', p_payload->>'title', 'body', p_payload->>'body',
        'recipients', (select coalesce(jsonb_agg(p.display_name order by p.display_name), '[]'::jsonb) from jsonb_array_elements_text(p_payload->'recipients') r join public.people p on p.id = r::uuid))
    when 'share_player_feedback' then jsonb_build_object('effect', 'Share feedback privately with ' || jsonb_array_length(p_payload->'recipients') || ' guardians',
        'body', p_payload->>'body', 'recipients', (select coalesce(jsonb_agg(p.display_name), '[]'::jsonb) from jsonb_array_elements_text(p_payload->'recipients') r join public.people p on p.id = r::uuid))
    when 'schedule_change' then jsonb_build_object('effect', 'Move ' || coalesce((select title from public.events where id = (p_payload->>'event_id')::uuid), 'event') || ' and notify the team',
        'starts_at', p_payload->'starts_at', 'ends_at', p_payload->'ends_at', 'location', p_payload->'location')
    when 'refund' then jsonb_build_object('effect', 'Refund ' || to_char((p_payload->>'amount_cents')::numeric / 100, 'FM999999990.00') || ' ' || (p_payload->>'currency') || ' to the original payment method',
        'amount_cents', p_payload->'amount_cents', 'currency', p_payload->'currency', 'payment_id', p_payload->'payment_id')
  end
$$;

create or replace function app.action_set_payload(p_action uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions;
begin
  select * into a from public.pending_actions where id = p_action for update;
  if a.payload_hash = app.hash(p_payload) then return; end if;
  update public.pending_actions set payload = p_payload, payload_hash = app.hash(p_payload), revision = revision + 1,
    summary = app.action_summary(kind, p_payload), status = 'in_review', status_reason = 'edited; review again',
    approved_by = null, approved_revision = null, approved_hash = null, version = version + 1, updated_at = now() where id = p_action;
end $$;

-- Authority + freshness check shared by approval and execution. Returns null
-- when valid, otherwise a plain-language reason. p_actor is the human approver.
create or replace function app.action_problem(a public.pending_actions) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb := a.payload; r text; v_team uuid := nullif(p->>'team_id','')::uuid; v_org uuid := nullif(p->>'org_id','')::uuid; e public.events; pay public.payments; inv public.invoices;
begin
  if a.requested_via = 'agent' and not app.staff_entitled(a.owner_person_id) then return 'Staff plan is not active, so staff-prepared work cannot be sent.'; end if;
  if a.prepared_work_id is not null and exists (select 1 from public.prepared_work w where w.id = a.prepared_work_id and app.sources_stale(w.sources)) then
    return 'Underlying information changed since this was prepared.'; end if;
  if a.kind = 'send_message' then
    if p->>'audience' = 'team' then
      if not (app.team_can(v_team, 'message_team') or exists (select 1 from public.teams t where t.id = v_team and t.org_id is not null and app.has_org_perm(t.org_id, 'communicate')))
        then return 'You no longer have permission to message this team.'; end if;
      for r in select jsonb_array_elements_text(p->'recipients') loop
        if not (r::uuid = any(app.conversation_audience(app.team_conversation(v_team)))) then return 'A recipient is no longer on this team.'; end if;
      end loop;
    elsif p->>'purpose' = 'attendance_reminder' then
      if not app.team_can(v_team, 'message_team') then return 'You no longer have permission to message this team.'; end if;
      select * into e from public.events where id = (p->>'event_id')::uuid;
      if e.status = 'cancelled' then return 'The event was cancelled.'; end if;
      for r in select jsonb_array_elements_text(p->'recipients') loop
        if not exists (select 1 from public.roster_entries re join public.guardianships g on g.athlete_id = re.athlete_id and g.status = 'active'
            where re.team_id = v_team and re.status = 'active' and g.guardian_person_id = r::uuid) then return 'A recipient is no longer a guardian on this team.'; end if;
      end loop;
    elsif p->>'purpose' = 'fee_reminder' then
      if not app.has_org_perm(v_org, 'manage_finance') then return 'You no longer have finance permission for this club.'; end if;
      for r in select jsonb_array_elements_text(p->'recipients') loop
        if not exists (select 1 from public.installments n join public.invoices i on i.id = n.invoice_id join public.guardianships g on g.athlete_id = i.athlete_id and g.status = 'active'
            where i.org_id = v_org and n.status = 'open' and n.due_on < current_date and g.guardian_person_id = r::uuid) then return 'A recipient no longer has an overdue balance.'; end if;
      end loop;
    elsif p->>'purpose' = 'certification_nudge' then
      if not app.has_org_perm(v_org, 'manage_compliance') then return 'You no longer have compliance permission for this club.'; end if;
      for r in select jsonb_array_elements_text(p->'recipients') loop
        if not exists (select 1 from public.certifications c where c.org_id = v_org and c.person_id = r::uuid and (c.status in ('missing','expired') or c.expires_on < current_date + 30))
          then return 'A recipient no longer has a certification gap.'; end if;
      end loop;
    else return 'Unsupported message purpose.';
    end if;
    if jsonb_array_length(p->'recipients') = 0 then return 'There is nobody to send this to.'; end if;
  elsif a.kind = 'share_player_feedback' then
    if not (app.team_can(v_team, 'plan_practice') and exists (select 1 from public.roster_entries re where re.team_id = v_team and re.athlete_id = (p->>'athlete_id')::uuid and re.status = 'active')) then
      return 'You can no longer share feedback for this athlete.'; end if;
    for r in select jsonb_array_elements_text(p->'recipients') loop
      if not exists (select 1 from public.guardianships g where g.athlete_id = (p->>'athlete_id')::uuid and g.guardian_person_id = r::uuid and g.status = 'active') then return 'A recipient is no longer this athlete''s guardian.'; end if;
    end loop;
    if jsonb_array_length(p->'recipients') = 0 then return 'This athlete has no approved guardian to share with.'; end if;
  elsif a.kind = 'schedule_change' then
    select * into e from public.events where id = (p->>'event_id')::uuid;
    if e.id is null or not app.team_can(e.team_id, 'manage_schedule') then return 'You can no longer change this schedule.'; end if;
    if e.version <> (a.dependencies->>'event_version')::int then return 'The event changed since this was proposed.'; end if;
  elsif a.kind = 'refund' then
    select * into pay from public.payments where id = (p->>'payment_id')::uuid;
    select * into inv from public.invoices where id = pay.invoice_id;
    if pay.id is null or not app.has_org_perm(inv.org_id, 'manage_finance') then return 'You no longer have finance permission for this club.'; end if;
    if pay.status not in ('succeeded','partially_refunded') then return 'This payment cannot be refunded in its current state.'; end if;
    if (p->>'amount_cents')::int > pay.amount_cents - pay.refunded_cents then return 'The refund is more than the refundable amount.'; end if;
    if pay.currency <> p->>'currency' then return 'Currency does not match the payment.'; end if;
  end if;
  return null;
end $$;

-- Human-initiated proposals (e.g. a director's refund, a coach's schedule
-- change). Agents propose through prepared_work_propose.
create or replace function public.action_propose(p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_deps jsonb := '{}'::jsonb; v_team uuid; v_org uuid; a public.pending_actions;
begin
  perform app.require_me();
  if p_kind = 'schedule_change' then
    select team_id, jsonb_build_object('event_version', version) into v_team, v_deps from public.events where id = (p_payload->>'event_id')::uuid;
  elsif p_kind = 'refund' then
    select i.org_id into v_org from public.payments p join public.invoices i on i.id = p.invoice_id where p.id = (p_payload->>'payment_id')::uuid;
  elsif p_kind <> 'send_message' then raise exception 'use prepared work for this kind';
  end if;
  if p_payload->>'audience' = 'team' then perform app.team_conversation((p_payload->>'team_id')::uuid); end if;
  insert into public.pending_actions(kind, owner_person_id, requested_via, org_id, team_id, payload, payload_hash, dependencies, summary, status)
  values (p_kind, app.me(), app.actor_kind(), coalesce(v_org, nullif(p_payload->>'org_id','')::uuid), coalesce(v_team, nullif(p_payload->>'team_id','')::uuid),
          p_payload, app.hash(p_payload), v_deps, app.action_summary(p_kind, p_payload), 'proposed') returning * into a;
  if app.action_problem(a) is not null then
    update public.pending_actions set status = 'needs_refresh', status_reason = app.action_problem(a) where id = a.id;
  else
    update public.pending_actions set status = 'in_review' where id = a.id;
  end if;
  perform app.audit('action.propose', 'pending_action', a.id::text, a.org_id, a.team_id, null, jsonb_build_object('kind', p_kind, 'via', app.actor_kind()));
  return a.id;
end $$;

create or replace function public.prepared_work_propose(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w public.prepared_work; v uuid; v_kind text; v_payload jsonb; a public.pending_actions;
begin
  perform app.require_me();
  select * into w from public.prepared_work where id = p_id for update;
  if w.id is null or w.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if w.kind in ('practice_plan','rotation') then raise exception 'practice plans are saved from the planner, not sent'; end if;
  select id into v from public.pending_actions where prepared_work_id = p_id and status in ('proposed','in_review','needs_refresh','queued','processing') limit 1;
  if v is not null then return v; end if;
  v_kind := case when w.kind = 'player_feedback' then 'share_player_feedback' else 'send_message' end;
  v_payload := app.payload_from_work(w.kind, w.artifact);
  insert into public.pending_actions(kind, prepared_work_id, owner_person_id, requested_via, org_id, team_id, payload, payload_hash, summary, status)
  values (v_kind, w.id, app.me(), w.created_via, w.org_id, w.team_id, v_payload, app.hash(v_payload), app.action_summary(v_kind, v_payload), 'proposed') returning * into a;
  update public.pending_actions set status = case when app.action_problem(a) is null then 'in_review' else 'needs_refresh' end, status_reason = app.action_problem(a) where id = a.id;
  update public.prepared_work set status = 'proposed', updated_at = now() where id = p_id;
  perform app.audit('action.propose', 'pending_action', a.id::text, a.org_id, a.team_id, null, jsonb_build_object('kind', v_kind, 'via', w.created_via));
  return a.id;
end $$;

create or replace function public.action_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'status_reason', a.status_reason, 'revision', a.revision, 'payload_hash', a.payload_hash,
    'summary', a.summary, 'requested_via', a.requested_via, 'approved_by', (select display_name from public.people where id = a.approved_by), 'approved_revision', a.approved_revision,
    'rejected_reason', a.rejected_reason, 'outcome', a.outcome, 'prepared_work_id', a.prepared_work_id, 'updated_at', a.updated_at,
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('attempt', t.attempt, 'outcome', t.outcome, 'detail', t.detail, 'at', t.at) order by t.id), '[]'::jsonb) from public.action_attempts t where t.action_id = a.id))
  from public.pending_actions a where a.id = p_id and a.owner_person_id = app.me()
$$;

-- Re-check an action that needs refresh (e.g. after sources changed) and bring
-- prepared work back into review with fresh source versions.
create or replace function public.action_refresh(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions; w public.prepared_work; prob text;
begin
  perform app.require_me();
  select * into a from public.pending_actions where id = p_id for update;
  if a.id is null or a.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.status not in ('needs_refresh','in_review','proposed') then raise exception 'this action cannot be refreshed now'; end if;
  if a.prepared_work_id is not null then
    select * into w from public.prepared_work where id = a.prepared_work_id for update;
    update public.prepared_work set sources = (select jsonb_agg(s || jsonb_build_object('version', app.source_version(s))) from jsonb_array_elements(w.sources) s), updated_at = now() where id = w.id;
    select * into a from public.pending_actions where id = p_id;
  end if;
  if a.kind = 'schedule_change' then
    update public.pending_actions set dependencies = jsonb_build_object('event_version', (select version from public.events where id = (a.payload->>'event_id')::uuid)) where id = p_id;
    select * into a from public.pending_actions where id = p_id;
  end if;
  prob := app.action_problem(a);
  update public.pending_actions set status = case when prob is null then 'in_review' else 'needs_refresh' end, status_reason = prob,
    approved_by = null, approved_revision = null, approved_hash = null, version = version + 1, updated_at = now() where id = p_id;
  return coalesce(prob, 'ok');
end $$;

-- Approval: only a person (never the staff runtime). The client must echo the
-- revision and hash it reviewed; any edit since then fails the approval.
-- Idempotent on p_approval_key.
create or replace function public.action_approve(p_id uuid, p_expected_revision int, p_expected_hash text, p_approval_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); a public.pending_actions; prob text;
begin
  if char_length(coalesce(p_approval_key,'')) not between 16 and 80 then raise exception 'bad approval key'; end if;
  select * into a from public.pending_actions where approval_key = p_approval_key;
  if a.id is not null then
    if a.id <> p_id then raise exception 'approval key reused for a different action' using errcode = '42501'; end if;
    return jsonb_build_object('status', a.status, 'replayed', true);
  end if;
  select * into a from public.pending_actions where id = p_id for update;
  if a.id is null or a.owner_person_id <> v_me then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.status not in ('proposed','in_review') then raise exception 'this action is % and cannot be approved', a.status using errcode = '55000'; end if;
  if a.revision <> p_expected_revision or a.payload_hash <> p_expected_hash then
    raise exception 'this action changed since you reviewed it; review the new version' using errcode = '40001'; end if;
  prob := app.action_problem(a);
  if prob is not null then
    update public.pending_actions set status = 'needs_refresh', status_reason = prob, version = version + 1, updated_at = now() where id = p_id;
    perform app.audit('action.approve_blocked', 'pending_action', p_id::text, a.org_id, a.team_id, prob);
    return jsonb_build_object('status', 'needs_refresh', 'reason', prob);
  end if;
  update public.pending_actions set status = 'queued', approved_by = v_me, approved_revision = a.revision, approved_hash = a.payload_hash,
    approval_key = p_approval_key, status_reason = null, version = version + 1, updated_at = now() where id = p_id;
  perform app.audit('action.approve', 'pending_action', p_id::text, a.org_id, a.team_id, null, jsonb_build_object('kind', a.kind, 'revision', a.revision));
  return jsonb_build_object('status', 'queued', 'replayed', false);
end $$;

-- Bulk approval: each item is validated on its own; results report partial
-- failures. Items must be listed explicitly with the revision reviewed.
create or replace function public.actions_approve_batch(p_items jsonb, p_batch_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); b public.action_batches; it jsonb; res jsonb := '[]'::jsonb; r jsonb; v_batch uuid;
begin
  select * into b from public.action_batches where idempotency_key = p_batch_key;
  if b.id is not null then
    if b.created_by <> v_me then raise exception 'not allowed' using errcode = '42501'; end if;
    return jsonb_build_object('batch_id', b.id, 'results', b.results, 'replayed', true);
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'a batch has 1 to 50 items'; end if;
  insert into public.action_batches(created_by, idempotency_key) values (v_me, p_batch_key) returning id into v_batch;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      r := public.action_approve((it->>'id')::uuid, (it->>'revision')::int, it->>'hash', p_batch_key || ':' || (it->>'id'));
      update public.pending_actions set batch_id = v_batch where id = (it->>'id')::uuid;
      res := res || jsonb_build_array(jsonb_build_object('id', it->>'id', 'ok', r->>'status' = 'queued', 'status', r->>'status', 'reason', r->>'reason'));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('id', it->>'id', 'ok', false, 'status', 'error', 'reason', sqlerrm));
    end;
  end loop;
  update public.action_batches set results = res where id = v_batch;
  return jsonb_build_object('batch_id', v_batch, 'results', res, 'replayed', false);
end $$;

create or replace function public.action_reject(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions;
begin
  perform app.require_human();
  select * into a from public.pending_actions where id = p_id for update;
  if a.id is null or a.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.status not in ('proposed','in_review','needs_refresh') then raise exception 'this action can no longer be rejected' using errcode = '55000'; end if;
  update public.pending_actions set status = 'rejected', rejected_reason = left(p_reason, 500), version = version + 1, updated_at = now() where id = p_id;
  update public.prepared_work set status = 'in_review', updated_at = now() where id = a.prepared_work_id;
  perform app.audit('action.reject', 'pending_action', p_id::text, a.org_id, a.team_id, p_reason);
end $$;

-- Retry makes a new revision of a rejected proposal; End closes it.
create or replace function public.action_retry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions; prob text;
begin
  perform app.require_me();
  select * into a from public.pending_actions where id = p_id for update;
  if a.id is null or a.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.status <> 'rejected' then raise exception 'only rejected actions can be retried'; end if;
  if a.prepared_work_id is not null then
    update public.pending_actions set payload = app.payload_from_work(w.kind, w.artifact) from public.prepared_work w where w.id = a.prepared_work_id and pending_actions.id = p_id;
    select * into a from public.pending_actions where id = p_id;
  end if;
  prob := app.action_problem(a);
  update public.pending_actions set status = case when prob is null then 'in_review' else 'needs_refresh' end, status_reason = prob, payload_hash = app.hash(payload),
    summary = app.action_summary(kind, payload), revision = revision + 1, rejected_reason = null, version = version + 1, updated_at = now() where id = p_id;
end $$;

create or replace function public.action_end(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions;
begin
  perform app.require_me();
  select * into a from public.pending_actions where id = p_id for update;
  if a.id is null or a.owner_person_id <> app.me() then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.status not in ('rejected','needs_refresh','in_review','proposed') then raise exception 'this action cannot be ended now'; end if;
  update public.pending_actions set status = 'ended', version = version + 1, updated_at = now() where id = p_id;
  update public.prepared_work set status = 'done', updated_at = now() where id = a.prepared_work_id;
end $$;

-- ---------------------------------------------------------------- execution (worker, service role)
create or replace function app.dm_between(p_a uuid, p_b uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select c.id into v from public.conversations c where c.kind = 'dm'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_a)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_b)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2;
  if v is null then
    insert into public.conversations(kind, created_by) values ('dm', p_a) returning id into v;
    insert into public.conversation_members(conversation_id, person_id, added_by) values (v, p_a, p_a), (v, p_b, p_a);
  end if;
  update public.conversation_members set left_at = null where conversation_id = v;
  return v;
end $$;

-- Runs one queued action. Authorization is re-evaluated as the approver
-- (request.jwt.claims is set to the approver for the duration), so a revoked
-- grant or changed source stops execution. Side effects inside the database
-- are idempotent via unique keys; external effects go to the outbox.
create or replace function app.execute_action(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.pending_actions; prob text; v_uid uuid; r text; v_conv uuid; v_msg uuid; n int; prior_claims text; e public.events; v_refund uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.pending_actions where id = p_id for update skip locked;
  if a.id is null then return 'locked_or_missing'; end if;
  if a.status <> 'queued' then return 'not_queued:' || a.status; end if;
  if a.approved_hash is distinct from a.payload_hash or a.approved_revision is distinct from a.revision then
    update public.pending_actions set status = 'needs_refresh', status_reason = 'Changed after approval.', version = version + 1, updated_at = now() where id = p_id;
    return 'needs_refresh';
  end if;
  n := coalesce((select max(attempt) from public.action_attempts where action_id = p_id), 0) + 1;
  -- evaluate as the approver
  select auth_user_id into v_uid from public.people where id = a.approved_by;
  prior_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  prob := app.action_problem(a);
  if prob is not null then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    insert into public.action_attempts(action_id, attempt, outcome, detail) values (p_id, n, 'revalidation_failed', prob);
    update public.pending_actions set status = 'needs_refresh', status_reason = prob, approved_by = null, approved_revision = null, approved_hash = null,
      approval_key = null, version = version + 1, updated_at = now() where id = p_id;
    return 'needs_refresh';
  end if;
  update public.pending_actions set status = 'processing', version = version + 1, updated_at = now() where id = p_id;

  if a.kind = 'send_message' and a.payload->>'audience' = 'team' then
    v_conv := app.team_conversation((a.payload->>'team_id')::uuid);
    insert into public.messages(conversation_id, sender_person_id, kind, title, body, prepared_by_role, source_action_id)
    values (v_conv, a.approved_by, 'announcement', a.payload->>'title', a.payload->>'body', (select role_id from public.prepared_work where id = a.prepared_work_id), a.id)
    on conflict (source_action_id, conversation_id) where source_action_id is not null do nothing returning id into v_msg;
    if v_msg is not null then
      update public.conversations set last_message_at = now() where id = v_conv;
      perform app.enqueue_deliveries(v_msg, array(select r2::uuid from jsonb_array_elements_text(a.payload->'recipients') r2), false);
    end if;
  elsif a.kind in ('send_message','share_player_feedback') then
    for r in select jsonb_array_elements_text(a.payload->'recipients') loop
      v_conv := app.dm_between(a.approved_by, r::uuid);
      insert into public.messages(conversation_id, sender_person_id, kind, title, body, prepared_by_role, source_action_id)
      values (v_conv, a.approved_by, 'message', a.payload->>'title', a.payload->>'body', (select role_id from public.prepared_work where id = a.prepared_work_id), a.id)
      on conflict (source_action_id, conversation_id) where source_action_id is not null do nothing returning id into v_msg;
      if v_msg is not null then
        update public.conversations set last_message_at = now() where id = v_conv;
        perform app.enqueue_deliveries(v_msg, array[r::uuid], false);
      end if;
    end loop;
  elsif a.kind = 'schedule_change' then
    select * into e from public.events where id = (a.payload->>'event_id')::uuid for update;
    update public.events set starts_at = (a.payload->>'starts_at')::timestamptz, ends_at = (a.payload->>'ends_at')::timestamptz,
      location = a.payload->>'location', status = 'changed', version = version + 1, updated_at = now() where id = e.id;
    v_conv := app.team_conversation(e.team_id);
    insert into public.messages(conversation_id, sender_person_id, kind, title, body, source_action_id)
    values (v_conv, a.approved_by, 'announcement', 'Schedule change', e.title || ' has moved. Check the schedule for the new time and place.', a.id)
    on conflict (source_action_id, conversation_id) where source_action_id is not null do nothing returning id into v_msg;
    if v_msg is not null then perform app.enqueue_deliveries(v_msg, array(select x from unnest(app.conversation_audience(v_conv)) x where x <> a.approved_by), false); end if;
  elsif a.kind = 'refund' then
    insert into public.refunds(payment_id, amount_cents, action_id, idempotency_key) values ((a.payload->>'payment_id')::uuid, (a.payload->>'amount_cents')::int, a.id, 'refund:' || a.id)
      on conflict (idempotency_key) do nothing returning id into v_refund;
    if v_refund is null then select id into v_refund from public.refunds where idempotency_key = 'refund:' || a.id; end if;
    insert into public.outbox(topic, ref_id, dedupe_key, payload) values ('refund', v_refund::text, 'refund:' || a.id, jsonb_build_object('refund_id', v_refund, 'action_id', a.id))
      on conflict (dedupe_key) do nothing;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    insert into public.action_attempts(action_id, attempt, outcome, detail) values (p_id, n, 'submitted_to_provider', 'sandbox');
    return 'processing';  -- completes when the provider result is applied
  end if;

  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  insert into public.action_attempts(action_id, attempt, outcome) values (p_id, n, 'succeeded');
  update public.pending_actions set status = 'succeeded', outcome = jsonb_build_object('at', now()), version = version + 1, updated_at = now() where id = p_id;
  update public.prepared_work set status = 'done', updated_at = now() where id = a.prepared_work_id;
  insert into public.audit_events(actor_person_id, actor_kind, org_id, team_id, action, target_type, target_id, metadata)
  values (a.approved_by, 'system', a.org_id, a.team_id, 'action.execute', 'pending_action', a.id::text, jsonb_build_object('kind', a.kind, 'outcome', 'succeeded'));
  return 'succeeded';
end $$;

create or replace function app.process_queued_actions(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; res jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  for r in select id from public.pending_actions where status = 'queued' order by updated_at limit p_limit loop
    res := res || jsonb_build_array(jsonb_build_object('id', r.id, 'result', app.execute_action(r.id)));
  end loop;
  return res;
end $$;

-- Provider result for a refund. 'uncertain' is recorded as such; the worker
-- reconciles by asking the provider about the idempotency key before any retry.
create or replace function app.refund_apply_result(p_refund uuid, p_outcome text, p_provider_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare f public.refunds; p public.payments;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from public.refunds where id = p_refund for update;
  if f.status = 'succeeded' then return 'already_succeeded'; end if;
  if p_outcome not in ('succeeded','failed','uncertain') then raise exception 'bad outcome'; end if;
  update public.refunds set status = p_outcome, provider_ref = coalesce(p_provider_ref, provider_ref), updated_at = now() where id = p_refund;
  if p_outcome = 'succeeded' then
    select * into p from public.payments where id = f.payment_id for update;
    update public.payments set refunded_cents = refunded_cents + f.amount_cents,
      status = case when refunded_cents + f.amount_cents >= amount_cents then 'refunded' else 'partially_refunded' end, updated_at = now() where id = p.id;
    perform app.recompute_invoice(p.invoice_id);
  end if;
  insert into public.action_attempts(action_id, attempt, outcome, detail)
  values (f.action_id, coalesce((select max(attempt) from public.action_attempts where action_id = f.action_id), 0) + 1, 'provider_' || p_outcome, p_provider_ref);
  update public.pending_actions set status = p_outcome, outcome = jsonb_build_object('refund_id', f.id, 'provider_ref', p_provider_ref), version = version + 1, updated_at = now()
    where id = f.action_id and status in ('processing','uncertain');
  return 'applied';
end $$;

grant execute on function app.execute_action(uuid), app.process_queued_actions(int), app.refund_apply_result(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- function grants
-- Default deny for functions: revoke from PUBLIC, then grant the public API to
-- authenticated users only. Nothing is callable by anon.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated, service_role;
-- Volatile app.* functions change data (audit writes, provider events, the
-- execution worker). Clients never call them directly: public RPCs reach them
-- as the function owner. Only stable/immutable helpers (used by RLS policies)
-- stay executable by authenticated.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.provolatile = 'v' loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;
-- app.* helpers are callable (RLS policies need them) but are not exposed over
-- the API because the app schema is not in the API's exposed schemas.
grant usage on schema app to service_role;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant usage on schema private to service_role;
grant usage, select on all sequences in schema public to service_role;
