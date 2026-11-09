-- Clubs as tenants.
--
-- A tenant is one club (organization). A team that has no club is its own
-- tenant, keyed by the team's id. A person can belong to several tenants
-- (a parent with children in two clubs, a coach who also volunteers
-- elsewhere). Every list the app shows is read inside one active tenant, and
-- the database refuses a tenant the person does not belong to. The existing
-- row-level rules still apply inside the tenant.
set check_function_bodies = off;

-- ---------------------------------------------------------------- helpers
create or replace function app.team_tenant(p_team uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(t.org_id, t.id) from public.teams t where t.id = p_team
$$;

create or replace function app.tenant_teams(p_tenant uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.teams t where t.org_id = p_tenant or (t.id = p_tenant and t.org_id is null)
$$;

-- Every tenant the signed-in person belongs to, and how.
create or replace function app.my_tenant_roles() returns table(tenant_id uuid, role text)
language sql stable security definer set search_path = '' as $$
  select g.org_id, 'club' from public.org_grants g
    where g.person_id = app.me() and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
  union select app.team_tenant(s.team_id), 'coach' from public.team_staff s where s.person_id = app.me() and s.revoked_at is null
  union select app.team_tenant(r.team_id), 'family' from public.guardianships g
    join public.roster_entries r on r.athlete_id = g.athlete_id and r.status <> 'removed'
    where g.guardian_person_id = app.me() and g.status = 'active'
  union select app.team_tenant(r.team_id), 'athlete' from public.athletes a
    join public.roster_entries r on r.athlete_id = a.id and r.status = 'active' where a.person_id = app.me()
  union select app.team_tenant(f.team_id), 'fan' from public.fan_follows f where f.fan_person_id = app.me() and f.status = 'active'
$$;

create or replace function app.tenant_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_tenant is not null and exists (select 1 from app.my_tenant_roles() r where r.tenant_id = p_tenant)
$$;

create or replace function app.require_tenant(p_tenant uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_me();
  if not app.tenant_member(p_tenant) then raise exception 'you are not a member of this club' using errcode = '42501'; end if;
  return p_tenant;
end $$;

-- Whether a row tagged with an org and/or team belongs to the tenant.
create or replace function app.in_tenant(p_tenant uuid, p_org uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_org is not null and p_org = p_tenant) or (p_team is not null and app.team_tenant(p_team) = p_tenant)
$$;

-- ---------------------------------------------------------------- tenant list and roles

drop function public.my_contexts();
-- The roles a person holds inside one tenant. Children, teams and follows in
-- other tenants are left out.
create or replace function public.my_contexts(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_tenant(p_tenant);
  return jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'display_name', p.display_name) from public.people p where p.id = app.me()),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'label', o.name, 'permissions', x.perms))
               from (select g.org_id, jsonb_agg(distinct g.permission) perms from public.org_grants g
                     where g.person_id = app.me() and g.org_id = p_tenant and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()) group by g.org_id) x
               join public.organizations o on o.id = x.org_id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'org_id', t.org_id, 'label', t.name, 'role', s.role) order by t.name)
               from public.team_staff s join public.teams t on t.id = s.team_id
               where s.person_id = app.me() and s.revoked_at is null and app.team_tenant(t.id) = p_tenant), '[]'::jsonb),
    'family', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name || ' ' || a.last_initial || '.', 'team_ids', x.team_ids) order by a.first_name)
               from public.guardianships g join public.athletes a on a.id = g.athlete_id
               cross join lateral (select jsonb_agg(r.team_id) team_ids from public.roster_entries r
                                   where r.athlete_id = a.id and r.status <> 'removed' and app.team_tenant(r.team_id) = p_tenant) x
               where g.guardian_person_id = app.me() and g.status = 'active' and x.team_ids is not null), '[]'::jsonb),
    'athlete', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name, 'team_ids', x.team_ids))
               from public.athletes a
               cross join lateral (select jsonb_agg(r.team_id) team_ids from public.roster_entries r
                                   where r.athlete_id = a.id and r.status = 'active' and app.team_tenant(r.team_id) = p_tenant) x
               where a.person_id = app.me() and x.team_ids is not null), '[]'::jsonb),
    'fan', coalesce((select jsonb_agg(jsonb_build_object('athlete_id', a.id, 'label', a.first_name || ' ' || a.last_initial || '.', 'team_ids', jsonb_build_array(f.team_id)))
               from public.fan_follows f join public.athletes a on a.id = f.athlete_id
               where f.fan_person_id = app.me() and f.status = 'active' and app.team_tenant(f.team_id) = p_tenant), '[]'::jsonb)
  );
end $$;

-- Every club a person belongs to, with the roles they hold in each (one person
-- can be a parent, a coach and a club director at once, in one club or several).
-- Each club's own scopes (its children, teams, follows) come with it, so the
-- role and scope switchers need no further reads. Data inside a club is still
-- read only through calls that name that club.
create or replace function public.my_tenants() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'display_name', p.display_name) from public.people p where p.id = app.me()),
    'tenants', coalesce((select jsonb_agg(jsonb_build_object('id', x.tenant_id, 'kind', case when o.id is null then 'team' else 'club' end,
                 'name', coalesce(o.name, t.name), 'roles', x.roles,
                 'contexts', public.my_contexts(x.tenant_id) - 'person') order by coalesce(o.name, t.name))
               from (select tenant_id, jsonb_agg(role order by role) roles from app.my_tenant_roles() group by tenant_id) x
               left join public.organizations o on o.id = x.tenant_id
               left join public.teams t on t.id = x.tenant_id and t.org_id is null), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------- fees and forms
drop function public.my_fees();
create or replace function public.my_fees(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_tenant(p_tenant);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'invoice_id', i.id, 'athlete', a.first_name || ' ' || a.last_initial || '.', 'club', o.name, 'description', i.description,
    'amount_cents', i.amount_cents, 'currency', i.currency, 'status', i.status,
    'paid_cents', (select coalesce(sum(p.amount_cents - p.refunded_cents),0) from public.payments p where p.invoice_id = i.id and p.status in ('succeeded','partially_refunded')),
    'installments', (select jsonb_agg(jsonb_build_object('id', n.id, 'seq', n.seq, 'amount_cents', n.amount_cents, 'due_on', n.due_on, 'status', n.status,
                       'pending', exists (select 1 from public.payments p where p.installment_id = n.id and p.status in ('pending','uncertain'))) order by n.seq)
                     from public.installments n where n.invoice_id = i.id),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'method', p.method, 'at', p.updated_at) order by p.created_at), '[]'::jsonb)
                 from public.payments p where p.invoice_id = i.id)
  ) order by i.created_at), '[]'::jsonb)
  from public.invoices i join public.athletes a on a.id = i.athlete_id join public.organizations o on o.id = i.org_id
  where i.org_id = p_tenant and (app.is_guardian_of(i.athlete_id) or (app.is_self_athlete(i.athlete_id) and a.age_band = 'adult')));
end $$;

drop function public.my_forms();
create or replace function public.my_forms(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_tenant(p_tenant);
  return (select coalesce(jsonb_agg(jsonb_build_object('document_id', d.id, 'title', d.title, 'kind', d.kind, 'version', d.version, 'body', d.body,
     'athlete_id', a.id, 'athlete', a.first_name, 'signed_at', s.signed_at) order by s.signed_at nulls first, d.title), '[]'::jsonb)
  from public.guardianships g join public.athletes a on a.id = g.athlete_id
  join public.roster_entries r on r.athlete_id = a.id and r.status <> 'removed'
  join public.teams t on t.id = r.team_id and t.org_id = p_tenant
  join public.documents d on d.org_id = t.org_id and d.required
  left join public.signatures s on s.document_id = d.id and s.document_version = d.version and s.athlete_id = a.id
  where g.guardian_person_id = app.me() and g.status = 'active');
end $$;

-- ---------------------------------------------------------------- messages
drop function public.my_conversations(text, boolean);
create or replace function public.my_conversations(p_tenant uuid, p_search text default null, p_archived boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_tenant(p_tenant);
  return (select coalesce(jsonb_agg(x order by x->>'last_message_at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'team_id', c.team_id,
      'title', coalesce(c.title, (select string_agg(p.display_name, ', ') from public.conversation_members m join public.people p on p.id = m.person_id where m.conversation_id = c.id and m.person_id <> app.me())),
      'last_message_at', c.last_message_at,
      'unread', coalesce(st.marked_unread, false) or exists (select 1 from public.messages m where m.conversation_id = c.id and m.deleted_at is null and not m.held_for_review
                 and m.sender_person_id <> app.me() and (st.last_read_at is null or m.created_at > st.last_read_at)),
      'archived', st.archived_at is not null) x
    from public.conversations c left join public.conversation_state st on st.conversation_id = c.id and st.person_id = app.me()
    where app.can_read_conversation(c.id) and app.in_tenant(p_tenant, c.org_id, c.team_id) and ((st.archived_at is not null) = coalesce(p_archived, false))
  ) q
  -- search the title as displayed (for direct messages, the other members' names)
  where p_search is null or x->>'title' ilike '%' || replace(replace(p_search, '%', ''), '_', '') || '%');
end $$;

-- A direct message belongs to the tenant it was started in. The same two
-- people get a separate conversation in each club they share.
drop function public.dm_start(uuid);
create or replace function public.dm_start(p_other uuid, p_tenant uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_human(); v uuid; v_org uuid; v_team uuid;
begin
  perform app.require_tenant(p_tenant);
  if p_other = v_me then raise exception 'you cannot message yourself'; end if;
  if app.person_is_minor(v_me) or app.person_is_minor(p_other) then
    raise exception 'private messages with athletes under 18 are not allowed; use the team conversation' using errcode = '42501'; end if;
  if not exists (select 1 from app.tenant_teams(p_tenant) tt(id) where app.is_team_member(tt.id)
                 and exists (select 1 from public.team_people(tt.id) tp where tp.person_id = p_other)) then
    raise exception 'you can message people who share a team with you in this club' using errcode = '42501'; end if;
  if exists (select 1 from public.organizations o where o.id = p_tenant) then v_org := p_tenant; else v_team := p_tenant; end if;
  select c.id into v from public.conversations c where c.kind = 'dm' and app.in_tenant(p_tenant, c.org_id, c.team_id)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = v_me)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_other);
  if v is not null then
    update public.conversation_members set left_at = null where conversation_id = v and person_id = v_me;
    return v;
  end if;
  insert into public.conversations(kind, created_by, org_id, team_id) values ('dm', v_me, v_org, v_team) returning id into v;
  insert into public.conversation_members(conversation_id, person_id, added_by) values (v, v_me, v_me), (v, p_other, v_me);
  return v;
end $$;

-- ---------------------------------------------------------------- staff work inside the tenant
drop function public.staff_room();
create or replace function public.staff_room(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_tenant(p_tenant);
  return jsonb_build_object(
    'entitlement', public.my_entitlement(),
    'titles', coalesce((select jsonb_object_agg(role_id, display_title) from public.staff_role_titles where person_id = app.me()), '{}'::jsonb),
    'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'role_id', w.role_id, 'title', w.title, 'summary', w.summary, 'status', w.status,
         'stale', app.sources_stale(w.sources), 'team_id', w.team_id, 'org_id', w.org_id, 'event_id', w.artifact->>'event_id', 'thread_id', w.thread_id, 'updated_at', w.updated_at,
         'action', (select jsonb_build_object('id', a.id, 'status', a.status, 'revision', a.revision) from public.pending_actions a where a.prepared_work_id = w.id order by a.created_at desc limit 1))
         order by w.updated_at desc) from public.prepared_work w
         where w.owner_person_id = app.me() and w.status not in ('dismissed') and app.in_tenant(p_tenant, w.org_id, w.team_id)), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'summary', a.summary, 'revision', a.revision, 'prepared_work_id', a.prepared_work_id, 'updated_at', a.updated_at) order by a.updated_at desc)
         from public.pending_actions a where a.owner_person_id = app.me() and a.prepared_work_id is null and app.in_tenant(p_tenant, a.org_id, a.team_id)), '[]'::jsonb)
  );
end $$;

-- Staff look for routine work inside one tenant only. Prepares, never sends.
drop function public.staff_run_triggers();
create or replace function public.staff_run_triggers(p_tenant uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.require_me(); n int := 0; r record; v_trigger text := 'daily:' || p_tenant;
begin
  perform app.require_staff_entitlement();
  perform app.require_tenant(p_tenant);
  if exists (select 1 from public.staff_jobs where person_id = v_me and trigger = v_trigger and ran_at > now() - interval '1 hour') then return 0; end if;
  -- RSVP reminders for the coming week's events that still have unanswered families
  for r in select e.id from public.events e
           where app.team_tenant(e.team_id) = p_tenant and app.team_can(e.team_id, 'message_team')
             and e.starts_at between now() and now() + interval '7 days' and e.status <> 'cancelled'
             and exists (select 1 from public.roster_entries re where re.team_id = e.team_id and re.status = 'active'
                         and not exists (select 1 from public.rsvps rv where rv.event_id = e.id and rv.athlete_id = re.athlete_id))
           order by e.starts_at limit 3 loop
    perform public.staff_prepare('attendance_reminder', jsonb_build_object('event_id', r.id)); n := n + 1;
  end loop;
  -- head coaches: next practice plan and the week-ahead announcement
  for r in select t.id from public.teams t
           where app.team_tenant(t.id) = p_tenant and 'head_coach' = any(app.team_role(t.id)) order by t.name limit 3 loop
    if app.team_can(r.id, 'plan_practice') then perform public.staff_prepare('practice_plan', jsonb_build_object('team_id', r.id)); n := n + 1; end if;
    if app.team_can(r.id, 'message_team') then perform public.staff_prepare('announcement', jsonb_build_object('team_id', r.id)); n := n + 1; end if;
  end loop;
  -- club staff: overdue balances and certification gaps
  if app.has_org_perm(p_tenant, 'manage_finance') and exists (select 1 from public.installments n2 join public.invoices i on i.id = n2.invoice_id
       where i.org_id = p_tenant and n2.status = 'open' and n2.due_on < current_date) then
    perform public.staff_prepare('fee_reminder', jsonb_build_object('org_id', p_tenant)); n := n + 1; end if;
  if app.has_org_perm(p_tenant, 'manage_compliance') and exists (select 1 from public.certifications c
       where c.org_id = p_tenant and (c.status in ('missing','expired') or c.expires_on < current_date + 30)) then
    perform public.staff_prepare('certification_nudge', jsonb_build_object('org_id', p_tenant)); n := n + 1; end if;
  insert into public.staff_jobs(person_id, trigger, created) values (v_me, v_trigger, n);
  return n;
end $$;

-- Private messages sent on approval land in the tenant the action belongs to.
create or replace function app.dm_between(p_a uuid, p_b uuid, p_tenant uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_org uuid; v_team uuid;
begin
  if exists (select 1 from public.organizations o where o.id = p_tenant) then v_org := p_tenant; else v_team := p_tenant; end if;
  select c.id into v from public.conversations c where c.kind = 'dm' and app.in_tenant(p_tenant, c.org_id, c.team_id)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_a)
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.person_id = p_b)
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2;
  if v is null then
    insert into public.conversations(kind, created_by, org_id, team_id) values ('dm', p_a, v_org, v_team) returning id into v;
    insert into public.conversation_members(conversation_id, person_id, added_by) values (v, p_a, p_a), (v, p_b, p_a);
  end if;
  update public.conversation_members set left_at = null where conversation_id = v;
  return v;
end $$;
drop function app.dm_between(uuid, uuid);

-- Unchanged from 20261107000500 except that direct messages carry the tenant.
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
      v_conv := app.dm_between(a.approved_by, r::uuid, coalesce(a.org_id, app.team_tenant(a.team_id)));
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
grant execute on function app.execute_action(uuid) to service_role;

-- ---------------------------------------------------------------- function grants
-- Same default deny as the earlier migrations, applied to the functions above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated, service_role;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.provolatile = 'v' loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;
