-- Messaging (one message object, per-recipient delivery), polls, surveys,
-- issue reporting, and the durable outbox used by every external side effect.

create table public.outbox (
  id bigint generated always as identity primary key,
  topic text not null check (topic in ('delivery','refund','rsvp_link')),
  ref_id text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','failed','uncertain')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  provider_ref text,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.outbox enable row level security; -- no client policies: workers use the service role

create table public.notification_prefs (
  person_id uuid primary key references public.people(id) on delete cascade,
  push boolean not null default true,
  email boolean not null default true,
  sms boolean not null default false,
  quiet_start time default '21:00',
  quiet_end time default '07:00',
  timezone text not null default 'America/Denver',
  share_contact_with_team boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.unsubscribes (
  person_id uuid not null references public.people(id) on delete cascade,
  channel text not null check (channel in ('email','sms','push')),
  at timestamptz not null default now(),
  primary key (person_id, channel)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  kind text not null check (kind in ('team','dm','group')),
  title text check (title is null or char_length(title) <= 80),
  created_by uuid references public.people(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index one_team_conversation on public.conversations(team_id) where kind = 'team';

-- Explicit membership for dm/group; team conversations are dynamic (current
-- team membership) so revocation takes effect immediately.
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_by uuid references public.people(id),
  left_at timestamptz,
  removed_by uuid references public.people(id),
  primary key (conversation_id, person_id)
);

create table public.conversation_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  last_read_at timestamptz,
  marked_unread boolean not null default false,
  archived_at timestamptz,
  primary key (conversation_id, person_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_person_id uuid not null references public.people(id),
  kind text not null default 'message' check (kind in ('message','announcement','emergency','poll')),
  title text check (title is null or char_length(title) <= 120),
  body text not null check (char_length(body) between 1 and 4000),
  parent_id uuid references public.messages(id),
  prepared_by_role text, -- staff role id when the content was staff-prepared and approved by the sender
  source_action_id uuid,
  held_for_review boolean not null default false,
  requires_ack boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index messages_conv_time on public.messages(conversation_id, created_at desc);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','🎉','😂','🙏','👀')),
  primary key (message_id, person_id, emoji)
);

create table public.message_acks (
  message_id uuid not null references public.messages(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (message_id, person_id)
);

create table public.message_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  flagged_by uuid references public.people(id),
  reason text not null check (char_length(reason) <= 200),
  status text not null default 'open' check (status in ('open','kept','removed')),
  created_at timestamptz not null default now()
);

create table public.deliveries (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  channel text not null check (channel in ('in_app','push','email','sms')),
  status text not null check (status in ('queued','deferred_quiet_hours','suppressed','sandbox_delivered','delivered','failed','uncertain')),
  updated_at timestamptz not null default now(),
  unique (message_id, person_id, channel)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  kind text not null default 'poll' check (kind in ('poll','captain_election')),
  question text not null check (char_length(question) between 1 and 200),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 10),
  closes_at timestamptz not null,
  created_by uuid references public.people(id)
);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  voter_person_id uuid not null references public.people(id) on delete cascade,
  option_index int not null,
  at timestamptz not null default now(),
  primary key (poll_id, voter_person_id)
);

create table public.rsvp_links (
  token_hash text primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  expires_at timestamptz not null
);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null check (kind in ('pulse','end_of_season')),
  title text not null,
  questions jsonb not null,
  allow_anonymous boolean not null default true,
  min_responses int not null default 5 check (min_responses >= 5),
  closes_at timestamptz not null,
  created_by uuid references public.people(id)
);

-- Responses never carry a client-visible sender. Named responses keep the
-- person here; anonymous ones keep it only in private.survey_identity.
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  answers jsonb not null,
  anonymous boolean not null,
  named_person_id uuid references public.people(id),
  submitted_at timestamptz not null default now(),
  check (anonymous = (named_person_id is null))
);
create table private.survey_identity (
  response_id uuid primary key references public.survey_responses(id) on delete cascade,
  person_id uuid not null,
  survey_id uuid not null,
  unique (survey_id, person_id)
);

create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  team_id uuid references public.teams(id),
  about_athlete_id uuid references public.athletes(id),
  category text not null check (category in ('safety','conduct','bullying','other')),
  body text not null check (char_length(body) between 1 and 4000),
  anonymous boolean not null,
  status text not null default 'open' check (status in ('open','in_review','closed')),
  created_at timestamptz not null default now()
);
create table private.issue_reporters (
  report_id uuid primary key references public.issue_reports(id) on delete cascade,
  person_id uuid not null,
  reporter_athlete_id uuid
);

alter table public.notification_prefs enable row level security;
alter table public.unsubscribes enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_state enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_acks enable row level security;
alter table public.message_flags enable row level security;
alter table public.deliveries enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.rsvp_links enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;
alter table public.issue_reports enable row level security;

create or replace function app.person_is_minor(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.person_id = p_person and a.age_band <> 'adult')
$$;
create or replace function app.person_band(p_person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.age_band from public.athletes a where a.person_id = p_person), 'adult')
$$;

create or replace function app.can_read_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = p_conv and (
    (c.kind = 'team' and app.is_team_member(c.team_id))
    or (c.kind <> 'team' and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = app.me() and m.left_at is null))))
$$;

grant select on public.notification_prefs, public.conversations, public.messages, public.message_reactions, public.polls, public.surveys, public.issue_reports to authenticated;
create policy prefs_self on public.notification_prefs for select to authenticated using (person_id = app.me());
create policy conversations_read on public.conversations for select to authenticated using (app.can_read_conversation(id));
create policy messages_read on public.messages for select to authenticated using (app.can_read_conversation(conversation_id) and deleted_at is null and (not held_for_review or sender_person_id = app.me()));
create policy reactions_read on public.message_reactions for select to authenticated using (exists (select 1 from public.messages m where m.id = message_id and app.can_read_conversation(m.conversation_id)));
create policy polls_read on public.polls for select to authenticated using (app.is_team_member(team_id));
create policy surveys_read on public.surveys for select to authenticated using (app.is_team_member(team_id));
-- survey_responses: no client select at all. issue_reports: through functions only.

-- ---------------------------------------------------------------- delivery planning
create or replace function app.in_quiet_hours(p_person uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when np.quiet_start is null or np.quiet_end is null then false
      when np.quiet_start <= np.quiet_end then (p_at at time zone np.timezone)::time >= np.quiet_start and (p_at at time zone np.timezone)::time < np.quiet_end
      else (p_at at time zone np.timezone)::time >= np.quiet_start or (p_at at time zone np.timezone)::time < np.quiet_end end
    from public.notification_prefs np where np.person_id = p_person), false)
$$;

create or replace function app.enqueue_deliveries(p_message uuid, p_recipients uuid[], p_emergency boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare r uuid; np public.notification_prefs; ch text; st text; n int := 0; quiet boolean;
begin
  foreach r in array p_recipients loop
    insert into public.deliveries(message_id, person_id, channel, status) values (p_message, r, 'in_app', 'delivered') on conflict do nothing;
    select * into np from public.notification_prefs where person_id = r;
    quiet := app.in_quiet_hours(r, now());
    foreach ch in array array['push','email','sms'] loop
      if (ch = 'push' and coalesce(np.push, true)) or (ch = 'email' and coalesce(np.email, true)) or (ch = 'sms' and coalesce(np.sms, false)) then
        st := case when exists (select 1 from public.unsubscribes u where u.person_id = r and u.channel = ch) then 'suppressed'
                   when quiet and not p_emergency and ch in ('push','sms') then 'deferred_quiet_hours' else 'queued' end;
        insert into public.deliveries(message_id, person_id, channel, status) values (p_message, r, ch, st) on conflict do nothing;
        if st = 'queued' then
          insert into public.outbox(topic, ref_id, dedupe_key, payload) values ('delivery', p_message::text, 'delivery:' || p_message || ':' || r || ':' || ch,
            jsonb_build_object('message_id', p_message, 'person_id', r, 'channel', ch)) on conflict (dedupe_key) do nothing;
        end if;
      end if;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.conversation_audience(p_conv uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.pid), '{}') from (
    select s.person_id pid from public.conversations c join public.team_staff s on s.team_id = c.team_id and s.revoked_at is null where c.id = p_conv and c.kind = 'team'
    union select g.guardian_person_id from public.conversations c join public.roster_entries r on r.team_id = c.team_id and r.status = 'active'
      join public.guardianships g on g.athlete_id = r.athlete_id and g.status = 'active' where c.id = p_conv and c.kind = 'team'
    union select a.person_id from public.conversations c join public.roster_entries r on r.team_id = c.team_id and r.status = 'active'
      join public.athletes a on a.id = r.athlete_id and a.person_id is not null where c.id = p_conv and c.kind = 'team'
    union select m.person_id from public.conversation_members m join public.conversations c on c.id = m.conversation_id where c.id = p_conv and c.kind <> 'team' and m.left_at is null
  ) x
$$;

create or replace function app.team_conversation(p_team uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.conversations where team_id = p_team and kind = 'team';
  if v is null then
    insert into public.conversations(team_id, org_id, kind, title) select t.id, t.org_id, 'team', t.name from public.teams t where t.id = p_team
    on conflict do nothing returning id into v;
    if v is null then select id into v from public.conversations where team_id = p_team and kind = 'team'; end if;
  end if;
  return v;
end $$;

-- Minimal blocklist moderation: matching posts are held for staff review.
create or replace function app.needs_moderation(p_body text) returns boolean
language sql immutable as $$
  select p_body ~* '\m(idiot|stupid|hate you|kill)\M'
$$;

-- ---------------------------------------------------------------- commands
create or replace function public.message_post(p_conversation uuid, p_body text, p_parent uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); c public.conversations; t public.teams; v uuid; held boolean; is_staff boolean;
begin
  perform app.rate_limit('message', 60, interval '10 minutes');
  select * into c from public.conversations where id = p_conversation;
  if c.id is null or not app.can_read_conversation(c.id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.kind = 'team' then
    select * into t from public.teams where id = c.team_id;
    is_staff := app.team_can(t.id, 'message_team');
    if not is_staff and t.messaging_mode <> 'two_way' and p_parent is null then raise exception 'this team is set to announcements only' using errcode = '42501'; end if;
    if not is_staff and t.messaging_mode = 'paused' then raise exception 'team messaging is paused' using errcode = '42501'; end if;
    if app.person_band(v_me) = 'under_13' then raise exception 'athletes under 13 cannot post in group conversations' using errcode = '42501'; end if;
  elsif c.kind = 'group' and app.person_band(v_me) = 'under_13' then
    raise exception 'athletes under 13 cannot post in group conversations' using errcode = '42501';
  end if;
  if p_parent is not null and not exists (select 1 from public.messages m where m.id = p_parent and m.conversation_id = c.id) then raise exception 'bad parent'; end if;
  held := app.needs_moderation(p_body);
  insert into public.messages(conversation_id, sender_person_id, body, parent_id, held_for_review) values (c.id, v_me, p_body, p_parent, held) returning id into v;
  if held then
    insert into public.message_flags(message_id, reason) values (v, 'automatic filter');
  else
    update public.conversations set last_message_at = now() where id = c.id;
    perform app.enqueue_deliveries(v, array(select x from unnest(app.conversation_audience(c.id)) x where x <> v_me), false);
  end if;
  return v;
end $$;

-- Human announcement to a team. Emergency alerts need a named sender, a reason,
-- override quiet hours, and ask recipients to acknowledge.
create or replace function public.announcement_post(p_team uuid, p_title text, p_body text, p_emergency boolean default false, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v_conv uuid; v uuid; t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if not (app.team_can(p_team, 'message_team') or (t.org_id is not null and app.has_org_perm(t.org_id, 'communicate'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_emergency and (p_reason is null or char_length(trim(p_reason)) < 5) then raise exception 'emergency alerts need a reason'; end if;
  v_conv := app.team_conversation(p_team);
  insert into public.messages(conversation_id, sender_person_id, kind, title, body, requires_ack)
  values (v_conv, v_me, case when p_emergency then 'emergency' else 'announcement' end, p_title, p_body, p_emergency) returning id into v;
  update public.conversations set last_message_at = now() where id = v_conv;
  perform app.enqueue_deliveries(v, array(select x from unnest(app.conversation_audience(v_conv)) x where x <> v_me), p_emergency);
  if p_emergency then perform app.audit('message.emergency', 'message', v::text, t.org_id, p_team, p_reason); end if;
  return v;
end $$;

create or replace function public.message_ack(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  perform app.require_human();
  select * into m from public.messages where id = p_message;
  if m.id is null or not app.can_read_conversation(m.conversation_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.message_acks(message_id, person_id) values (p_message, app.me()) on conflict do nothing;
end $$;

create or replace function public.message_delete_own(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  update public.messages set deleted_at = now() where id = p_message and sender_person_id = app.me() and deleted_at is null;
  if not found then raise exception 'you can only delete your own messages' using errcode = '42501'; end if;
end $$;

create or replace function public.message_react(p_message uuid, p_emoji text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  perform app.require_human();
  select * into m from public.messages where id = p_message;
  if m.id is null or not app.can_read_conversation(m.conversation_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on then insert into public.message_reactions values (p_message, app.me(), p_emoji) on conflict do nothing;
  else delete from public.message_reactions where message_id = p_message and person_id = app.me() and emoji = p_emoji; end if;
end $$;

create or replace function public.message_flag(p_message uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  perform app.require_human();
  select * into m from public.messages where id = p_message;
  if m.id is null or not app.can_read_conversation(m.conversation_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.message_flags(message_id, flagged_by, reason) values (p_message, app.me(), p_reason);
end $$;

create or replace function public.moderation_queue(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.team_can(p_team, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('flag_id', f.id, 'message_id', m.id, 'body', m.body, 'reason', f.reason, 'sender', p.display_name, 'held', m.held_for_review))
    from public.message_flags f join public.messages m on m.id = f.message_id join public.conversations c on c.id = m.conversation_id join public.people p on p.id = m.sender_person_id
    where c.team_id = p_team and f.status = 'open'), '[]'::jsonb);
end $$;

create or replace function public.moderation_decide(p_flag uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.message_flags; m public.messages; c public.conversations;
begin
  perform app.require_human();
  select * into f from public.message_flags where id = p_flag for update;
  select * into m from public.messages where id = f.message_id;
  select * into c from public.conversations where id = m.conversation_id;
  if c.team_id is null or not app.team_can(c.team_id, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.message_flags set status = case when p_remove then 'removed' else 'kept' end where id = p_flag;
  if p_remove then update public.messages set deleted_at = now() where id = m.id;
  elsif m.held_for_review then
    update public.messages set held_for_review = false where id = m.id;
    perform app.enqueue_deliveries(m.id, array(select x from unnest(app.conversation_audience(c.id)) x where x <> m.sender_person_id), false);
  end if;
  perform app.audit('moderation.' || case when p_remove then 'remove' else 'keep' end, 'message', m.id::text, c.org_id, c.team_id);
end $$;

-- DMs: adults only, and only between people who already share a team or club.
create or replace function public.dm_start(p_other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid;
begin
  if p_other = v_me then raise exception 'you cannot message yourself'; end if;
  if app.person_is_minor(v_me) or app.person_is_minor(p_other) then
    raise exception 'private messages with athletes under 18 are not allowed; use the team conversation' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams t where app.is_team_member(t.id) and exists (select 1 from public.team_people(t.id) tp where tp.person_id = p_other)) then
    raise exception 'you can message people who share a team with you' using errcode = '42501'; end if;
  select c.id into v from public.conversations c where c.kind = 'dm'
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = v_me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_other);
  if v is not null then
    update public.conversation_members set left_at = null where conversation_id = v and person_id = v_me;
    return v;
  end if;
  insert into public.conversations(kind, created_by) values ('dm', v_me) returning id into v;
  insert into public.conversation_members(conversation_id, person_id, added_by) values (v, v_me, v_me), (v, p_other, v_me);
  return v;
end $$;

create or replace function public.group_create(p_team uuid, p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid; m uuid;
begin
  if not app.team_can(p_team, 'message_team') then raise exception 'only team staff can create titled groups' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) = 0 then raise exception 'groups need a title'; end if;
  foreach m in array p_members loop
    if not exists (select 1 from public.team_people(p_team) tp where tp.person_id = m) then raise exception 'group members must be adults on this team'; end if;
  end loop;
  insert into public.conversations(team_id, kind, title, created_by) values (p_team, 'group', p_title, v_me) returning id into v;
  insert into public.conversation_members(conversation_id, person_id, added_by) select v, x, v_me from unnest(array_append(p_members, v_me)) x on conflict do nothing;
  return v;
end $$;

create or replace function public.conversation_leave(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  update public.conversation_members set left_at = now() where conversation_id = p_conversation and person_id = app.me() and left_at is null;
  if not found then raise exception 'you can leave groups and direct messages; team conversations can be archived instead'; end if;
end $$;

create or replace function public.conversation_remove_member(p_conversation uuid, p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  perform app.require_human();
  select * into c from public.conversations where id = p_conversation;
  if c.kind <> 'group' or not app.team_can(c.team_id, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.conversation_members set left_at = now(), removed_by = app.me() where conversation_id = p_conversation and person_id = p_person;
end $$;

-- Per-person state: read/unread, mark unread, archive/restore (bulk via arrays).
create or replace function public.conversation_set_state(p_conversations uuid[], p_action text) returns int
language plpgsql security definer set search_path = '' as $$
declare c uuid; n int := 0;
begin
  perform app.require_human();
  if p_action not in ('read','unread','archive','restore') then raise exception 'bad action'; end if;
  foreach c in array p_conversations loop
    if not app.can_read_conversation(c) then continue; end if;
    insert into public.conversation_state(conversation_id, person_id) values (c, app.me()) on conflict do nothing;
    update public.conversation_state set
      last_read_at = case when p_action = 'read' then now() else last_read_at end,
      marked_unread = case when p_action = 'unread' then true when p_action = 'read' then false else marked_unread end,
      archived_at = case when p_action = 'archive' then now() when p_action = 'restore' then null else archived_at end
    where conversation_id = c and person_id = app.me();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.my_conversations(p_search text default null, p_archived boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'last_message_at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'team_id', c.team_id,
      'title', coalesce(c.title, (select string_agg(p.display_name, ', ') from public.conversation_members m join public.people p on p.id = m.person_id where m.conversation_id = c.id and m.person_id <> app.me())),
      'last_message_at', c.last_message_at,
      'unread', coalesce(st.marked_unread, false) or exists (select 1 from public.messages m where m.conversation_id = c.id and m.deleted_at is null and not m.held_for_review
                 and m.sender_person_id <> app.me() and (st.last_read_at is null or m.created_at > st.last_read_at)),
      'archived', st.archived_at is not null) x
    from public.conversations c left join public.conversation_state st on st.conversation_id = c.id and st.person_id = app.me()
    where app.can_read_conversation(c.id) and ((st.archived_at is not null) = coalesce(p_archived, false))
  ) q
  -- search the title as displayed (for direct messages, the other members' names)
  where p_search is null or x->>'title' ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%'
$$;

-- Recent history with "fetch more" (keyset pagination on created_at).
create or replace function public.conversation_messages(p_conversation uuid, p_before timestamptz default null, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_read_conversation(p_conversation) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'created_at') from (
    select jsonb_build_object('id', m.id, 'kind', m.kind, 'title', m.title, 'body', m.body, 'parent_id', m.parent_id, 'created_at', m.created_at,
      'sender', p.display_name, 'mine', m.sender_person_id = app.me(), 'prepared_by_role', m.prepared_by_role, 'requires_ack', m.requires_ack,
      'acked', exists (select 1 from public.message_acks a where a.message_id = m.id and a.person_id = app.me()),
      'held', m.held_for_review,
      'reactions', (select coalesce(jsonb_object_agg(emoji, n), '{}'::jsonb) from (select emoji, count(*) n from public.message_reactions r where r.message_id = m.id group by emoji) rr)) x
    from public.messages m join public.people p on p.id = m.sender_person_id
    where m.conversation_id = p_conversation and m.deleted_at is null and (not m.held_for_review or m.sender_person_id = app.me())
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc limit least(greatest(p_limit, 1), 100)) q), '[]'::jsonb);
end $$;

create or replace function public.notification_prefs_set(p_push boolean, p_email boolean, p_sms boolean, p_quiet_start time, p_quiet_end time, p_timezone text, p_share_contact boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  insert into public.notification_prefs(person_id, push, email, sms, quiet_start, quiet_end, timezone, share_contact_with_team)
  values (app.me(), p_push, p_email, p_sms, p_quiet_start, p_quiet_end, p_timezone, p_share_contact)
  on conflict (person_id) do update set push = excluded.push, email = excluded.email, sms = excluded.sms, quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end, timezone = excluded.timezone, share_contact_with_team = excluded.share_contact_with_team, updated_at = now();
end $$;

-- ---------------------------------------------------------------- polls
create or replace function public.poll_create(p_team uuid, p_kind text, p_question text, p_options jsonb, p_closes timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_msg uuid; v_conv uuid;
begin
  perform app.require_human();
  if not app.team_can(p_team, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_closes <= now() then raise exception 'deadline must be in the future'; end if;
  v_conv := app.team_conversation(p_team);
  insert into public.messages(conversation_id, sender_person_id, kind, body) values (v_conv, app.me(), 'poll', p_question) returning id into v_msg;
  insert into public.polls(team_id, message_id, kind, question, options, closes_at, created_by) values (p_team, v_msg, p_kind, p_question, p_options, p_closes, app.me()) returning id into v;
  return v;
end $$;

-- Captain elections: only rostered athletes with their own account vote
-- (PRD voter rules unavailable; see docs/POLICY_QUESTIONS.md).
create or replace function public.poll_vote(p_poll uuid, p_option int) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.polls;
begin
  perform app.require_human();
  select * into p from public.polls where id = p_poll;
  if p.id is null or not app.is_team_member(p.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p.closes_at <= now() then raise exception 'this poll is closed'; end if;
  if p_option < 0 or p_option >= jsonb_array_length(p.options) then raise exception 'bad option'; end if;
  if p.kind = 'captain_election' and not exists (select 1 from public.roster_entries r join public.athletes a on a.id = r.athlete_id
      where r.team_id = p.team_id and r.status = 'active' and a.person_id = app.me()) then
    raise exception 'only athletes on the roster vote in captain elections' using errcode = '42501'; end if;
  insert into public.poll_votes(poll_id, voter_person_id, option_index) values (p_poll, app.me(), p_option)
  on conflict (poll_id, voter_person_id) do update set option_index = excluded.option_index, at = now();
end $$;

create or replace function public.poll_results(p_poll uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.polls; voted boolean;
begin
  select * into p from public.polls where id = p_poll;
  if p.id is null or not app.is_team_member(p.team_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  voted := exists (select 1 from public.poll_votes v where v.poll_id = p_poll and v.voter_person_id = app.me());
  return jsonb_build_object('poll', jsonb_build_object('id', p.id, 'question', p.question, 'options', p.options, 'closes_at', p.closes_at, 'kind', p.kind),
    'my_vote', (select option_index from public.poll_votes v where v.poll_id = p_poll and v.voter_person_id = app.me()),
    'counts', case when voted or p.closes_at <= now() or app.team_can(p.team_id, 'message_team')
      then (select coalesce(jsonb_object_agg(option_index, n), '{}'::jsonb) from (select option_index, count(*) n from public.poll_votes where poll_id = p_poll group by 1) c) end);
end $$;

-- ---------------------------------------------------------------- SMS/email RSVP replies
create or replace function app.rsvp_link_create(p_event uuid, p_athlete uuid, p_person uuid, p_channel text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not exists (select 1 from public.guardianships g where g.athlete_id = p_athlete and g.guardian_person_id = p_person and g.status = 'active') then
    raise exception 'recipient is not a guardian of this athlete'; end if;
  insert into public.rsvp_links(token_hash, event_id, athlete_id, person_id, channel, expires_at)
  select encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex'), p_event, p_athlete, p_person, p_channel, least(e.starts_at, now() + interval '7 days') from public.events e where e.id = p_event;
  return v_token;
end $$;

-- Applied by the verified inbound SMS/email webhook (service role). The token
-- scopes the reply to one athlete and one event; the provider message id
-- prevents replay; the guardian relationship is re-checked at apply time.
create or replace function app.rsvp_apply_reply(p_provider text, p_provider_message_id text, p_token text, p_text text) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.rsvp_links; st text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  begin insert into private.provider_events(provider, event_id) values (p_provider, p_provider_message_id);
  exception when unique_violation then return 'replay_ignored'; end;
  select * into l from public.rsvp_links where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if l.token_hash is null or l.expires_at < now() then return 'invalid_or_expired'; end if;
  if not exists (select 1 from public.guardianships g where g.athlete_id = l.athlete_id and g.guardian_person_id = l.person_id and g.status = 'active') then return 'relationship_revoked'; end if;
  st := case lower(regexp_replace(trim(p_text), '[.!]+$', '')) when 'y' then 'yes' when 'yes' then 'yes' when 'n' then 'no' when 'no' then 'no' when 'maybe' then 'maybe' else null end;
  if st is null then return 'unrecognized'; end if;
  insert into public.rsvps(event_id, athlete_id, status, responded_by, via) values (l.event_id, l.athlete_id, st, l.person_id, l.channel)
  on conflict (event_id, athlete_id) do update set status = excluded.status, responded_by = excluded.responded_by, via = excluded.via, responded_at = now();
  return 'applied:' || st;
end $$;
grant execute on function app.rsvp_apply_reply(text, text, text, text) to service_role;

-- ---------------------------------------------------------------- surveys and feedback
create or replace function public.survey_create(p_team uuid, p_kind text, p_title text, p_questions jsonb, p_closes timestamptz, p_allow_anonymous boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_human();
  if not app.team_can(p_team, 'message_team') then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.surveys(team_id, kind, title, questions, closes_at, allow_anonymous, created_by) values (p_team, p_kind, p_title, p_questions, p_closes, p_allow_anonymous, app.me()) returning id into v;
  return v;
end $$;

create or replace function public.survey_submit(p_survey uuid, p_answers jsonb, p_anonymous boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); s public.surveys; v uuid; band text := app.person_band(v_me);
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null or not app.is_team_member(s.team_id) or cardinality(app.team_role(s.team_id)) > 0 then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.closes_at <= now() then raise exception 'this survey is closed'; end if;
  if p_anonymous and not s.allow_anonymous then raise exception 'this survey is not anonymous'; end if;
  if p_anonymous and band <> 'adult' then raise exception 'athletes under 18 submit named feedback; a guardian can see it' using errcode = '42501'; end if;
  if band = 'under_13' then raise exception 'athletes under 13 respond through a guardian' using errcode = '42501'; end if;
  insert into public.survey_responses(survey_id, answers, anonymous, named_person_id) values (p_survey, p_answers, p_anonymous, case when p_anonymous then null else v_me end) returning id into v;
  begin
    insert into private.survey_identity(response_id, person_id, survey_id) values (v, v_me, p_survey);
  exception when unique_violation then raise exception 'you already responded to this survey'; end;
  return v;
end $$;

-- Aggregates only, and only at or above the minimum response count.
create or replace function public.survey_summary(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.surveys; n int;
begin
  select * into s from public.surveys where id = p_survey;
  if s.id is null or not app.team_can(s.team_id, 'view_feedback_summary') then raise exception 'not allowed' using errcode = '42501'; end if;
  select count(*) into n from public.survey_responses where survey_id = p_survey;
  if n < s.min_responses then
    return jsonb_build_object('suppressed', true, 'responses', n, 'minimum', s.min_responses);
  end if;
  return jsonb_build_object('suppressed', false, 'responses', n, 'questions', (
    select jsonb_agg(jsonb_build_object('key', q->>'key', 'label', q->>'label',
      'average', (select round(avg((r.answers->>(q->>'key'))::numeric), 2) from public.survey_responses r where r.survey_id = p_survey and (r.answers->>(q->>'key')) ~ '^\d+(\.\d+)?$')))
    from jsonb_array_elements(s.questions) q));
end $$;

create or replace function public.issue_report_submit(p_team uuid, p_category text, p_body text, p_anonymous boolean, p_about_athlete uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid; v_org uuid; v_self_athlete uuid;
begin
  if not app.is_team_member(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  select org_id into v_org from public.teams where id = p_team;
  select id into v_self_athlete from public.athletes where person_id = v_me;
  if p_anonymous and app.person_band(v_me) <> 'adult' then raise exception 'reports from athletes under 18 are shared with their guardian and are not anonymous' using errcode = '42501'; end if;
  insert into public.issue_reports(org_id, team_id, about_athlete_id, category, body, anonymous) values (v_org, p_team, p_about_athlete, p_category, p_body, p_anonymous) returning id into v;
  insert into private.issue_reporters(report_id, person_id, reporter_athlete_id) values (v, v_me, v_self_athlete);
  perform app.audit('issue.submit', 'issue_report', v::text, v_org, p_team);
  return v;
end $$;

-- Who can see a report: the reporter; guardians of a minor reporter or of the
-- minor it is about (guardian-visible pathway); people explicitly granted
-- review_safeguarding. Coaches and owners do NOT get access by default.
create or replace function public.issue_reports_visible() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'body', r.body, 'status', r.status, 'created_at', r.created_at,
      'anonymous', r.anonymous, 'mine', ir.person_id = app.me(),
      'reporter', case when not r.anonymous and (app.has_org_perm(r.org_id, 'review_safeguarding') or (ir.reporter_athlete_id is not null and app.is_guardian_of(ir.reporter_athlete_id)))
                       then (select display_name from public.people where id = ir.person_id) end)
      order by r.created_at desc), '[]'::jsonb)
  from public.issue_reports r join private.issue_reporters ir on ir.report_id = r.id
  where ir.person_id = app.me()
     or (r.org_id is not null and app.has_org_perm(r.org_id, 'review_safeguarding'))
     or (ir.reporter_athlete_id is not null and app.is_guardian_of(ir.reporter_athlete_id))
     or (r.about_athlete_id is not null and app.is_guardian_of(r.about_athlete_id) and (select age_band from public.athletes where id = r.about_athlete_id) <> 'adult')
$$;

-- Resolving an anonymous identity requires an explicit safeguarding grant and a
-- reason, and is always audited.
-- Returns {"allowed": false} instead of raising on denial so the denial audit
-- row commits with the call.
create or replace function public.anonymous_identity_resolve(p_kind text, p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_person uuid;
begin
  perform app.require_human();
  if p_reason is null or char_length(trim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required'; end if;
  if p_kind = 'survey_response' then
    select t.org_id, si.person_id into v_org, v_person from public.survey_responses r join public.surveys s on s.id = r.survey_id join public.teams t on t.id = s.team_id
      join private.survey_identity si on si.response_id = r.id where r.id = p_id;
  elsif p_kind = 'issue_report' then
    select r.org_id, ir.person_id into v_org, v_person from public.issue_reports r join private.issue_reporters ir on ir.report_id = r.id where r.id = p_id;
  else raise exception 'bad kind'; end if;
  if v_org is null or not app.has_org_perm(v_org, 'review_safeguarding') then
    perform app.audit('identity.resolve_denied', p_kind, p_id::text, v_org, null, p_reason);
    return jsonb_build_object('allowed', false);
  end if;
  perform app.audit('identity.resolve', p_kind, p_id::text, v_org, null, p_reason);
  return jsonb_build_object('allowed', true, 'display_name', (select display_name from public.people where id = v_person));
end $$;
