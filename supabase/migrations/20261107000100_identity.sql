-- OpenSeason: identity, organizations, teams, relationships, grants, claims, consent, audit.
-- Default deny: every table has RLS enabled; nothing is granted to anon.
-- Commands are security-definer RPCs that derive the actor from auth.uid()
-- and never accept a client-supplied person/approver/guardian id.

-- Supabase installs extensions in the `extensions` schema; match that locally.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;      -- internal helpers, not exposed over the API
create schema if not exists private;  -- protected data (anonymous identity maps, secrets)
revoke all on schema app from public;
revoke all on schema private from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------- people
create table public.people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email text check (email is null or char_length(email) <= 254),
  -- adults only; minors' DOB lives in private.athlete_dob
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'America/Denver',
  club_values text not null default '' check (char_length(club_values) <= 4000),
  playbook_terms jsonb not null default '{}'::jsonb,
  created_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

create table public.org_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  permission text not null check (permission in ('owner','manage_teams','manage_finance','manage_tryouts','manage_compliance','communicate','review_safeguarding')),
  granted_by uuid references public.people(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.people(id)
);
create unique index org_grants_active_uq on public.org_grants(org_id, person_id, permission) where revoked_at is null;

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('planning','active','closed','archived')),
  check (ends_on >= starts_on)
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null
);

-- ---------------------------------------------------------------- teams
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  sport text not null default 'basketball',
  age_group text,
  timezone text not null default 'America/Denver',
  messaging_mode text not null default 'two_way' check (messaging_mode in ('two_way','announcements_only','paused')),
  roster_version int not null default 1,
  created_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

create table public.team_club_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references public.people(id),
  status text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  decided_by uuid references public.people(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index team_club_requests_pending_uq on public.team_club_requests(team_id) where status = 'pending';

create table public.team_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null check (role in ('head_coach','assistant_coach','scorekeeper')),
  granted_by uuid references public.people(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index team_staff_active_uq on public.team_staff(team_id, person_id, role) where revoked_at is null;

-- ---------------------------------------------------------------- athletes and family
create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid unique references public.people(id), -- set when the athlete has their own login
  first_name text not null check (char_length(first_name) between 1 and 40),
  last_initial text not null check (char_length(last_initial) between 1 and 2),
  age_band text not null check (age_band in ('under_13','teen','adult')),
  created_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

-- Field-level protection: DOB is visible only to active guardians, the athlete (adult),
-- and org compliance managers. Separate table so membership never implies DOB access.
create table private.athlete_dob (
  athlete_id uuid primary key references public.athletes(id) on delete cascade,
  dob date not null
);

create table public.guardianships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  guardian_person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  approved_by uuid references public.people(id),
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index guardianships_live_uq on public.guardianships(athlete_id, guardian_person_id) where status <> 'revoked';

create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  jersey text check (jersey is null or char_length(jersey) <= 4),
  status text not null default 'active' check (status in ('invited','active','removed')),
  added_by uuid references public.people(id),
  created_at timestamptz not null default now()
);
create unique index roster_live_uq on public.roster_entries(team_id, athlete_id) where status <> 'removed';

create table public.fan_follows (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  fan_person_id uuid not null references public.people(id) on delete cascade,
  invited_by uuid not null references public.people(id),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  kind text not null check (kind in ('guardian_verifiable','participation','media')),
  status text not null default 'pending' check (status in ('pending','verified','revoked')),
  method text check (method in ('checkbox','provider_verified','in_person_verified')),
  provider_ref text,
  granted_by uuid references public.people(id),
  updated_at timestamptz not null default now()
);
create unique index consents_uq on public.consents(athlete_id, kind);

-- ---------------------------------------------------------------- invitations and claims
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('guardian','assistant_coach','fan','org_grant')),
  email_normalized text not null check (char_length(email_normalized) <= 254),
  team_id uuid references public.teams(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete cascade,
  permission text,
  token_hash text not null,
  invited_by uuid not null references public.people(id),
  status text not null default 'open' check (status in ('open','claimed','revoked','expired')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','conflict','withdrawn')),
  decided_by uuid references public.people(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index claims_one_live_per_person on public.claims(invitation_id, person_id) where status in ('pending_approval','conflict');

create table private.claim_attempts (
  person_id uuid not null,
  attempted_at timestamptz not null default now(),
  ok boolean not null
);

-- ---------------------------------------------------------------- audit (append-only)
create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_person_id uuid,
  actor_kind text not null check (actor_kind in ('person','agent','system','platform_ops')),
  org_id uuid,
  team_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  reason text check (reason is null or char_length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb
);

create table private.platform_operators (
  person_id uuid primary key references public.people(id)
);

-- ================================================================ helpers
create or replace function app.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.people p where p.auth_user_id = auth.uid()
$$;

-- 'agent' when the request comes from the staff runtime acting for the person.
create or replace function app.actor_kind() returns text
language sql stable set search_path = '' as $$
  select case when auth.jwt()->>'os_actor' = 'agent' then 'agent' else 'person' end
$$;

create or replace function app.require_me() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := app.me();
begin
  if v is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function app.require_human() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.actor_kind() <> 'person' then
    raise exception 'staff cannot perform this action; it needs a person' using errcode = '42501';
  end if;
  return app.require_me();
end $$;

create or replace function app.has_org_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_grants g
    where g.org_id = p_org and g.person_id = app.me() and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (g.permission = p_perm or (g.permission = 'owner' and p_perm <> 'review_safeguarding'))
  )
$$;

create or replace function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_grants g where g.org_id = p_org and g.person_id = app.me()
                   and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()))
$$;

create or replace function app.team_role(p_team uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.role), '{}') from public.team_staff s
  where s.team_id = p_team and s.person_id = app.me() and s.revoked_at is null
$$;

-- capability check mirrors packages/domain/src/permissions.ts
create or replace function app.team_can(p_team uuid, p_cap text) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    ('head_coach' = any(app.team_role(p_team)) and p_cap in ('view_roster','manage_roster','manage_schedule','take_attendance','plan_practice','score','message_team','invite_family','invite_staff','view_feedback_summary','delegate_scoring'))
    or ('assistant_coach' = any(app.team_role(p_team)) and p_cap in ('view_roster','take_attendance','plan_practice','score'))
    or ('scorekeeper' = any(app.team_role(p_team)) and p_cap = 'score')
    or (p_cap in ('view_roster','manage_roster','manage_schedule','message_team','invite_family','invite_staff')
        and exists (select 1 from public.teams t where t.id = p_team and t.org_id is not null and app.has_org_perm(t.org_id, 'manage_teams')))
$$;

create or replace function app.is_guardian_of(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardianships g where g.athlete_id = p_athlete
                   and g.guardian_person_id = app.me() and g.status = 'active')
$$;

create or replace function app.is_self_athlete(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.id = p_athlete and a.person_id = app.me() and a.person_id is not null)
$$;

-- Family-side membership: guardian of (or the athlete) on an active roster entry.
create or replace function app.is_team_family(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roster_entries r
    where r.team_id = p_team and r.status = 'active'
      and (app.is_guardian_of(r.athlete_id) or app.is_self_athlete(r.athlete_id))
  )
$$;

create or replace function app.is_team_fan(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fan_follows f
    join public.roster_entries r on r.athlete_id = f.athlete_id and r.team_id = f.team_id and r.status = 'active'
    where f.team_id = p_team and f.fan_person_id = app.me() and f.status = 'active'
  )
$$;

-- Members (staff, family, org managers) — not fans.
create or replace function app.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(app.team_role(p_team)) > 0 or app.is_team_family(p_team) or app.team_can(p_team, 'view_roster')
$$;

create or replace function app.can_view_team_calendar(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_team_member(p_team) or app.is_team_fan(p_team)
$$;

create or replace function app.can_view_athlete(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_guardian_of(p_athlete) or app.is_self_athlete(p_athlete)
    or exists (select 1 from public.roster_entries r where r.athlete_id = p_athlete and r.status <> 'removed'
               and app.team_can(r.team_id, 'view_roster'))
$$;

create or replace function app.audit(p_action text, p_target_type text, p_target_id text, p_org uuid default null, p_team uuid default null, p_reason text default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events(actor_person_id, actor_kind, org_id, team_id, action, target_type, target_id, reason, metadata)
  values (app.me(), case when auth.role() = 'service_role' then 'system' else app.actor_kind() end, p_org, p_team, p_action, p_target_type, p_target_id, p_reason, p_meta)
$$;

create or replace function app.rate_limit(p_bucket text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into private.rate_events(person_id, bucket) values (app.me(), p_bucket);
  select count(*) into n from private.rate_events where person_id = app.me() and bucket = p_bucket and at > now() - p_window;
  if n > p_max then raise exception 'too many requests, try again later' using errcode = '53400'; end if;
end $$;
create table private.rate_events (person_id uuid, bucket text not null, at timestamptz not null default now());
create index on private.rate_events(person_id, bucket, at);

-- ================================================================ RLS
alter table public.people enable row level security;
alter table public.organizations enable row level security;
alter table public.org_grants enable row level security;
alter table public.seasons enable row level security;
alter table public.programs enable row level security;
alter table public.teams enable row level security;
alter table public.team_club_requests enable row level security;
alter table public.team_staff enable row level security;
alter table public.athletes enable row level security;
alter table private.athlete_dob enable row level security;
alter table public.guardianships enable row level security;
alter table public.roster_entries enable row level security;
alter table public.fan_follows enable row level security;
alter table public.consents enable row level security;
alter table public.invitations enable row level security;
alter table public.claims enable row level security;
alter table public.audit_events enable row level security;

-- Reads only; all writes go through RPCs below.
grant select on public.people, public.organizations, public.org_grants, public.seasons, public.programs, public.teams,
  public.team_club_requests, public.team_staff, public.athletes, public.guardianships, public.roster_entries,
  public.fan_follows, public.consents, public.claims, public.audit_events to authenticated;

create policy people_self on public.people for select to authenticated using (id = app.me());
create policy orgs_members on public.organizations for select to authenticated using (app.is_org_member(id)
  or exists (select 1 from public.teams t where t.org_id = organizations.id and app.is_team_member(t.id)));
create policy org_grants_read on public.org_grants for select to authenticated using (person_id = app.me() or app.has_org_perm(org_id, 'owner'));
create policy seasons_read on public.seasons for select to authenticated using (app.is_org_member(org_id));
create policy programs_read on public.programs for select to authenticated using (app.is_org_member(org_id));
create policy teams_read on public.teams for select to authenticated using (app.can_view_team_calendar(id) or (org_id is not null and app.has_org_perm(org_id, 'manage_teams')));
create policy club_requests_read on public.team_club_requests for select to authenticated using (requested_by = app.me() or app.has_org_perm(org_id, 'manage_teams'));
create policy team_staff_read on public.team_staff for select to authenticated using (person_id = app.me() or app.is_team_member(team_id));
create policy athletes_read on public.athletes for select to authenticated using (app.can_view_athlete(id));
create policy guardianships_read on public.guardianships for select to authenticated using (guardian_person_id = app.me() or app.is_guardian_of(athlete_id));
create policy roster_read on public.roster_entries for select to authenticated using (app.team_can(team_id, 'view_roster') or app.is_guardian_of(athlete_id) or app.is_self_athlete(athlete_id));
create policy fan_follows_read on public.fan_follows for select to authenticated using (fan_person_id = app.me() or invited_by = app.me() or app.is_guardian_of(athlete_id));
create policy consents_read on public.consents for select to authenticated using (app.is_guardian_of(athlete_id) or app.is_self_athlete(athlete_id)
  or exists (select 1 from public.roster_entries r join public.teams t on t.id = r.team_id
             where r.athlete_id = consents.athlete_id and r.status <> 'removed' and (app.team_can(r.team_id,'view_roster') or (t.org_id is not null and app.has_org_perm(t.org_id,'manage_compliance')))));
create policy claims_read on public.claims for select to authenticated using (person_id = app.me());
create policy audit_read on public.audit_events for select to authenticated using (org_id is not null and app.has_org_perm(org_id, 'owner'));
-- invitations and private.* have no select policy for clients at all.

-- ================================================================ commands
create or replace function public.ensure_person(p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select id into v from public.people where auth_user_id = auth.uid();
  if v is not null then return v; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.people(auth_user_id, display_name, email)
  values (auth.uid(), left(coalesce(nullif(trim(p_display_name), ''), 'New member'), 80), lower(v_email)) returning id into v;
  return v;
end $$;

create or replace function public.org_create(p_name text, p_timezone text default 'America/Denver') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid;
begin
  insert into public.organizations(name, timezone, created_by) values (p_name, p_timezone, v_me) returning id into v;
  insert into public.org_grants(org_id, person_id, permission, granted_by) values (v, v_me, 'owner', v_me);
  perform app.audit('org.create', 'organization', v::text, v);
  return v;
end $$;

create or replace function public.org_grant(p_org uuid, p_person uuid, p_permission text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid;
begin
  if not app.has_org_perm(p_org, 'owner') then raise exception 'only an organization owner can delegate permissions' using errcode = '42501'; end if;
  if p_permission = 'owner' and not exists (select 1 from public.org_grants where org_id = p_org and person_id = v_me and permission = 'owner' and revoked_at is null) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.org_grants(org_id, person_id, permission, granted_by) values (p_org, p_person, p_permission, v_me) returning id into v;
  perform app.audit('grant.create', 'org_grant', v::text, p_org, null, null, jsonb_build_object('permission', p_permission, 'person', p_person));
  return v;
end $$;

create or replace function public.org_revoke_grant(p_grant uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); g public.org_grants;
begin
  select * into g from public.org_grants where id = p_grant for update;
  if g.id is null or not app.has_org_perm(g.org_id, 'owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  if g.permission = 'owner' and (select count(*) from public.org_grants where org_id = g.org_id and permission = 'owner' and revoked_at is null) <= 1 then
    raise exception 'an organization needs at least one owner'; end if;
  update public.org_grants set revoked_at = now(), revoked_by = v_me where id = p_grant;
  perform app.audit('grant.revoke', 'org_grant', p_grant::text, g.org_id, null, p_reason);
end $$;

create or replace function public.team_create(p_name text, p_age_group text, p_timezone text default 'America/Denver') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid;
begin
  insert into public.teams(name, age_group, timezone, created_by) values (p_name, p_age_group, p_timezone, v_me) returning id into v;
  insert into public.team_staff(team_id, person_id, role, granted_by) values (v, v_me, 'head_coach', v_me);
  perform app.audit('team.create', 'team', v::text, null, v);
  return v;
end $$;

-- Club association requires approval by someone holding manage_teams in that club.
create or replace function public.team_request_club(p_team uuid, p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid;
begin
  if not ('head_coach' = any(app.team_role(p_team))) then raise exception 'only the head coach can request club association' using errcode = '42501'; end if;
  insert into public.team_club_requests(team_id, org_id, requested_by) values (p_team, p_org, v_me) returning id into v;
  perform app.audit('team.club_request', 'team', p_team::text, p_org, p_team);
  return v;
end $$;

create or replace function public.team_club_decide(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); r public.team_club_requests;
begin
  select * into r from public.team_club_requests where id = p_request for update;
  if r.id is null or not app.has_org_perm(r.org_id, 'manage_teams') then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'request already decided'; end if;
  update public.team_club_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = v_me, decided_at = now() where id = p_request;
  if p_approve then update public.teams set org_id = r.org_id where id = r.team_id; end if;
  perform app.audit(case when p_approve then 'team.club_approve' else 'team.club_decline' end, 'team', r.team_id::text, r.org_id, r.team_id);
end $$;

create or replace function public.team_staff_revoke(p_team_staff uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); s public.team_staff;
begin
  select * into s from public.team_staff where id = p_team_staff for update;
  if s.id is null or not app.team_can(s.team_id, 'invite_staff') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.team_staff set revoked_at = now() where id = p_team_staff;
  perform app.audit('team_staff.revoke', 'team_staff', p_team_staff::text, null, s.team_id, p_reason);
end $$;

-- Coach-created athlete records start without any guardian; a guardian must be
-- invited and approved before family access exists.
create or replace function public.athlete_create_for_team(p_team uuid, p_first text, p_last_initial text, p_dob date, p_jersey text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid; v_band text;
begin
  if not app.team_can(p_team, 'manage_roster') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_band := case when p_dob is null then 'under_13'
                 when age(current_date, p_dob) < interval '13 years' then 'under_13'
                 when age(current_date, p_dob) < interval '18 years' then 'teen' else 'adult' end;
  insert into public.athletes(first_name, last_initial, age_band, created_by) values (p_first, p_last_initial, v_band, v_me) returning id into v;
  if p_dob is not null then insert into private.athlete_dob(athlete_id, dob) values (v, p_dob); end if;
  -- minors are 'invited' until a guardian is approved (and, under 13, verified consent exists)
  insert into public.roster_entries(team_id, athlete_id, jersey, status, added_by) values (p_team, v, p_jersey, case when v_band = 'adult' then 'active' else 'invited' end, v_me);
  insert into public.consents(athlete_id, kind, status) values (v, 'guardian_verifiable', 'pending');
  update public.teams set roster_version = roster_version + 1 where id = p_team;
  perform app.audit('athlete.create', 'athlete', v::text, null, p_team);
  return v;
end $$;

create or replace function public.roster_remove(p_team uuid, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  if not app.team_can(p_team, 'manage_roster') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.roster_entries set status = 'removed' where team_id = p_team and athlete_id = p_athlete and status <> 'removed';
  update public.teams set roster_version = roster_version + 1 where id = p_team;
  perform app.audit('roster.remove', 'athlete', p_athlete::text, null, p_team);
end $$;

-- Invitations. The raw token is returned once to the inviter's server-side
-- delivery path (sandbox outbox), only its hash is stored.
create or replace function public.invite_create(p_kind text, p_email text, p_team uuid, p_athlete uuid, p_org uuid default null, p_permission text default null)
returns table(invitation_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := app.require_human(); v_token text := encode(extensions.gen_random_bytes(24), 'hex'); v uuid;
begin
  perform app.rate_limit('invite', 50, interval '1 hour');
  if p_kind = 'guardian' then
    if not app.team_can(p_team, 'invite_family') then raise exception 'not allowed' using errcode = '42501'; end if;
    if not exists (select 1 from public.roster_entries where team_id = p_team and athlete_id = p_athlete and status <> 'removed') then raise exception 'athlete not on this team'; end if;
  elsif p_kind = 'assistant_coach' then
    if not app.team_can(p_team, 'invite_staff') then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif p_kind = 'fan' then
    if not app.is_guardian_of(p_athlete) then raise exception 'only a guardian can invite fans' using errcode = '42501'; end if;
    if not exists (select 1 from public.roster_entries where team_id = p_team and athlete_id = p_athlete and status = 'active') then raise exception 'athlete not on this team'; end if;
  elsif p_kind = 'org_grant' then
    if not app.has_org_perm(p_org, 'owner') then raise exception 'not allowed' using errcode = '42501'; end if;
  else raise exception 'unknown invitation kind'; end if;
  insert into public.invitations(kind, email_normalized, team_id, org_id, athlete_id, permission, token_hash, invited_by)
  values (p_kind, lower(trim(p_email)), p_team, p_org, p_athlete, p_permission, encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex'), v_me)
  returning id into v;
  perform app.audit('invite.create', 'invitation', v::text, p_org, p_team, null, jsonb_build_object('kind', p_kind));
  return query select v, v_token;
end $$;

create or replace function public.invite_revoke(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  perform app.require_human();
  select * into i from public.invitations where id = p_invitation for update;
  if i.id is null or not (i.invited_by = app.me() or (i.team_id is not null and app.team_can(i.team_id, 'invite_family')) or (i.org_id is not null and app.has_org_perm(i.org_id, 'owner'))) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update public.invitations set status = 'revoked' where id = p_invitation;
  update public.claims set status = 'withdrawn' where invitation_id = p_invitation and status in ('pending_approval','conflict');
  perform app.audit('invite.revoke', 'invitation', p_invitation::text, i.org_id, i.team_id);
end $$;

-- Email match is only a candidate signal. Candidates expose the team name and
-- relationship kind; never the athlete or any family record.
create or replace function public.my_claim_candidates() returns table(invitation_id uuid, kind text, team_name text, invited_by_name text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.kind, t.name, p.display_name, i.expires_at
  from public.invitations i
  join public.people me on me.id = app.me()
  join public.people p on p.id = i.invited_by
  left join public.teams t on t.id = i.team_id
  where i.status = 'open' and i.expires_at > now() and me.email is not null and i.email_normalized = me.email
    and not exists (select 1 from public.claims c where c.invitation_id = i.id and c.person_id = me.id and c.status in ('pending_approval','conflict','approved'))
$$;

-- Claiming requires the secret token from the invitation link (proof the
-- invite reached this person) AND, for guardians, approval by team staff.
-- Fans and assistant coaches are claimed by token alone (inviter already vouched).
create or replace function public.claim_submit(p_token text) returns table(claim_id uuid, status text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := app.require_human(); i public.invitations; v uuid; v_status text;
begin
  perform app.rate_limit('claim', 10, interval '1 hour');
  select * into i from public.invitations where token_hash = encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex') for update;
  if i.id is null or i.status <> 'open' or i.expires_at <= now() then
    -- Returned, not raised, so the attempt and rate-limit rows commit and
    -- brute-force guessing is actually counted.
    insert into private.claim_attempts(person_id, ok) values (v_me, false);
    return query select null::uuid, 'invalid'::text;
    return;
  end if;
  insert into private.claim_attempts(person_id, ok) values (v_me, true);
  if i.kind = 'guardian' then
    v_status := case when exists (select 1 from public.claims c where c.invitation_id = i.id and c.person_id <> v_me and c.status in ('pending_approval','approved'))
                     then 'conflict' else 'pending_approval' end;
    insert into public.claims(invitation_id, person_id, status) values (i.id, v_me, v_status) returning id into v;
    if v_status = 'conflict' then update public.claims set status = 'conflict' where invitation_id = i.id and status = 'pending_approval'; end if;
  elsif i.kind = 'fan' then
    insert into public.claims(invitation_id, person_id, status, decided_at) values (i.id, v_me, 'approved', now()) returning id into v;
    insert into public.fan_follows(athlete_id, team_id, fan_person_id, invited_by) values (i.athlete_id, i.team_id, v_me, i.invited_by);
    update public.invitations set status = 'claimed' where id = i.id;
    v_status := 'approved';
  elsif i.kind = 'assistant_coach' then
    insert into public.claims(invitation_id, person_id, status, decided_at) values (i.id, v_me, 'approved', now()) returning id into v;
    insert into public.team_staff(team_id, person_id, role, granted_by) values (i.team_id, v_me, 'assistant_coach', i.invited_by);
    update public.invitations set status = 'claimed' where id = i.id;
    v_status := 'approved';
  elsif i.kind = 'org_grant' then
    insert into public.claims(invitation_id, person_id, status, decided_at) values (i.id, v_me, 'approved', now()) returning id into v;
    insert into public.org_grants(org_id, person_id, permission, granted_by) values (i.org_id, v_me, i.permission, i.invited_by);
    update public.invitations set status = 'claimed' where id = i.id;
    v_status := 'approved';
  end if;
  perform app.audit('claim.submit', 'claim', v::text, i.org_id, i.team_id, null, jsonb_build_object('kind', i.kind, 'status', v_status));
  return query select v, v_status;
end $$;

-- Staff view of guardian claims waiting on them: name of claimant + athlete on their roster only.
create or replace function public.team_pending_claims(p_team uuid) returns table(claim_id uuid, claimant_name text, athlete_first text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, p.display_name, a.first_name, c.status, c.created_at
  from public.claims c join public.invitations i on i.id = c.invitation_id
  join public.people p on p.id = c.person_id join public.athletes a on a.id = i.athlete_id
  where i.team_id = p_team and i.kind = 'guardian' and c.status in ('pending_approval','conflict') and app.team_can(p_team, 'invite_family')
$$;

create or replace function public.claim_decide(p_claim uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); c public.claims; i public.invitations;
begin
  select * into c from public.claims where id = p_claim for update;
  select * into i from public.invitations where id = c.invitation_id for update;
  if c.id is null or i.kind <> 'guardian' or not app.team_can(i.team_id, 'invite_family') then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.person_id = v_me then raise exception 'you cannot approve your own claim' using errcode = '42501'; end if;
  if c.status not in ('pending_approval','conflict') then raise exception 'claim already decided'; end if;
  if i.status <> 'open' then raise exception 'invitation no longer open'; end if;
  if p_approve then
    update public.claims set status = 'approved', decided_by = v_me, decided_at = now() where id = p_claim;
    update public.claims set status = 'rejected', decided_by = v_me, decided_at = now() where invitation_id = i.id and id <> p_claim and status in ('pending_approval','conflict');
    insert into public.guardianships(athlete_id, guardian_person_id, status, approved_by, approved_at) values (i.athlete_id, c.person_id, 'active', v_me, now())
      on conflict do nothing;
    update public.invitations set status = 'claimed' where id = i.id;
    -- teens become active once a guardian exists; under-13 also needs verified consent
    update public.roster_entries r set status = 'active' from public.athletes a
      where r.athlete_id = i.athlete_id and a.id = r.athlete_id and r.status = 'invited' and a.age_band = 'teen';
  else
    update public.claims set status = 'rejected', decided_by = v_me, decided_at = now() where id = p_claim;
  end if;
  perform app.audit(case when p_approve then 'claim.approve' else 'claim.reject' end, 'claim', p_claim::text, null, i.team_id, p_reason);
end $$;

create or replace function public.guardianship_revoke(p_guardianship uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.guardianships;
begin
  perform app.require_human();
  select * into g from public.guardianships where id = p_guardianship for update;
  if g.id is null or not (g.guardian_person_id = app.me() or exists (
      select 1 from public.roster_entries r join public.teams t on t.id = r.team_id
      where r.athlete_id = g.athlete_id and t.org_id is not null and app.has_org_perm(t.org_id, 'manage_compliance'))) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update public.guardianships set status = 'revoked', revoked_at = now() where id = p_guardianship;
  -- revoking a guardian also revokes fan follows that guardian created for that athlete
  update public.fan_follows set status = 'revoked', revoked_at = now() where athlete_id = g.athlete_id and invited_by = g.guardian_person_id and status = 'active';
  perform app.audit('guardianship.revoke', 'guardianship', p_guardianship::text, null, null, p_reason);
end $$;

create or replace function public.fan_follow_revoke(p_follow uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.fan_follows;
begin
  perform app.require_human();
  select * into f from public.fan_follows where id = p_follow for update;
  if f.id is null or not (f.fan_person_id = app.me() or app.is_guardian_of(f.athlete_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.fan_follows set status = 'revoked', revoked_at = now() where id = p_follow;
  perform app.audit('fan.revoke', 'fan_follow', p_follow::text);
end $$;

-- Consent. Only the sandbox/provider webhook path (service role) can mark
-- under-13 consent verified; a guardian checkbox records intent only.
create or replace function public.consent_guardian_start(p_athlete uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ref text := 'vc_' || encode(extensions.gen_random_bytes(12), 'hex');
begin
  perform app.require_human();
  if not app.is_guardian_of(p_athlete) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.consents set status = 'pending', method = null, provider_ref = v_ref, granted_by = app.me(), updated_at = now()
    where athlete_id = p_athlete and kind = 'guardian_verifiable';
  perform app.audit('consent.start', 'athlete', p_athlete::text);
  return v_ref;
end $$;

create or replace function app.consent_provider_verified(p_ref text, p_method text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.consents;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_method not in ('provider_verified','in_person_verified') then raise exception 'method not acceptable'; end if;
  select * into c from public.consents where provider_ref = p_ref for update;
  if c.id is null then raise exception 'unknown consent reference'; end if;
  update public.consents set status = 'verified', method = p_method, updated_at = now() where id = c.id;
  update public.roster_entries set status = 'active' where athlete_id = c.athlete_id and status = 'invited'
    and exists (select 1 from public.guardianships g where g.athlete_id = c.athlete_id and g.status = 'active');
  insert into public.audit_events(actor_kind, action, target_type, target_id, metadata) values ('system','consent.verified','athlete',c.athlete_id::text, jsonb_build_object('method', p_method));
end $$;
grant execute on function app.consent_provider_verified(text, text) to service_role;

create or replace function public.consent_revoke(p_athlete uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  if not app.is_guardian_of(p_athlete) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.consents set status = 'revoked', updated_at = now() where athlete_id = p_athlete and kind = p_kind;
  perform app.audit('consent.revoke', 'athlete', p_athlete::text, null, null, null, jsonb_build_object('kind', p_kind));
end $$;

create or replace function public.athlete_dob_get(p_athlete uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare d date;
begin
  if not (app.is_guardian_of(p_athlete) or app.is_self_athlete(p_athlete) or exists (
    select 1 from public.roster_entries r join public.teams t on t.id = r.team_id
    where r.athlete_id = p_athlete and t.org_id is not null and app.has_org_perm(t.org_id, 'manage_compliance'))) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select dob into d from private.athlete_dob where athlete_id = p_athlete;
  return d;
end $$;

-- Contexts a person can switch between. Derived from relationships and grants.
create or replace function public.my_contexts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'display_name', p.display_name) from public.people p where p.id = app.me()),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'label', o.name, 'permissions', x.perms) order by o.name)
               from (select g.org_id, jsonb_agg(distinct g.permission) perms from public.org_grants g
                     where g.person_id = app.me() and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()) group by g.org_id) x
               join public.organizations o on o.id = x.org_id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'org_id', t.org_id, 'label', t.name, 'role', s.role) order by t.name)
               from public.team_staff s join public.teams t on t.id = s.team_id where s.person_id = app.me() and s.revoked_at is null), '[]'::jsonb),
    'family', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name || ' ' || a.last_initial || '.',
                 'team_ids', coalesce((select jsonb_agg(r.team_id) from public.roster_entries r where r.athlete_id = a.id and r.status <> 'removed'), '[]'::jsonb)) order by a.first_name)
               from public.guardianships g join public.athletes a on a.id = g.athlete_id where g.guardian_person_id = app.me() and g.status = 'active'), '[]'::jsonb),
    'athlete', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name,
                 'team_ids', coalesce((select jsonb_agg(r.team_id) from public.roster_entries r where r.athlete_id = a.id and r.status = 'active'), '[]'::jsonb)))
               from public.athletes a where a.person_id = app.me()), '[]'::jsonb),
    'fan', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name || ' ' || a.last_initial || '.', 'team_ids', jsonb_build_array(f.team_id)))
               from public.fan_follows f join public.athletes a on a.id = f.athlete_id where f.fan_person_id = app.me() and f.status = 'active'), '[]'::jsonb)
  )
$$;

-- Names (no contact details) of people a member can legitimately see on a team.
create or replace function public.team_people(p_team uuid) returns table(person_id uuid, display_name text, relation text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, s.role from public.team_staff s join public.people p on p.id = s.person_id
    where s.team_id = p_team and s.revoked_at is null and app.is_team_member(p_team)
  union all
  select p.id, p.display_name, 'guardian' from public.roster_entries r
    join public.guardianships g on g.athlete_id = r.athlete_id and g.status = 'active'
    join public.people p on p.id = g.guardian_person_id
    where r.team_id = p_team and r.status <> 'removed' and app.team_can(p_team, 'view_roster')
$$;

create or replace function public.team_roster(p_team uuid) returns table(athlete_id uuid, first_name text, last_initial text, jersey text, status text, age_band text, guardians int, consent text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.first_name, a.last_initial, r.jersey, r.status, a.age_band,
    (select count(*)::int from public.guardianships g where g.athlete_id = a.id and g.status = 'active'),
    (select c.status from public.consents c where c.athlete_id = a.id and c.kind = 'guardian_verifiable')
  from public.roster_entries r join public.athletes a on a.id = r.athlete_id
  where r.team_id = p_team and r.status <> 'removed' and app.team_can(p_team, 'view_roster')
  order by a.first_name
$$;
