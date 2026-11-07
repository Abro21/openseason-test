-- Club fees and payments (DIY, free), compliance, tryouts, and the separate
-- OpenSeason staff subscription entitlement. No card data is ever stored:
-- payments go through a provider-hosted checkout (sandbox adapter locally).

create table public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('registration','deposit','installment_plan','ad_hoc','tryout')),
  amount_cents int not null check (amount_cents between 0 and 10000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  installments int not null default 1 check (installments between 1 and 24),
  first_due date not null,
  created_by uuid references public.people(id),
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  fee_schedule_id uuid references public.fee_schedules(id) on delete set null,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  description text not null,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'open' check (status in ('open','partially_paid','paid','void','refunded')),
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  seq int not null,
  amount_cents int not null check (amount_cents >= 0),
  due_on date not null,
  status text not null default 'open' check (status in ('open','paid','void')),
  unique (invoice_id, seq)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  installment_id uuid references public.installments(id),
  amount_cents int not null check (amount_cents > 0),
  currency text not null,
  method text not null check (method in ('provider_checkout','offline_cash','offline_check','offline_other')),
  provider text check (provider in ('sandbox')),
  provider_ref text unique,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','uncertain','refunded','partially_refunded')),
  refunded_cents int not null default 0,
  idempotency_key text not null unique,
  initiated_by uuid references public.people(id),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','uncertain')),
  provider_ref text,
  action_id uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook replay protection: a provider event id is applied at most once.
create table private.provider_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('waiver','agreement','code_of_conduct','media_release')),
  title text not null,
  body text not null check (char_length(body) <= 20000),
  version int not null default 1,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version int not null,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  signer_person_id uuid not null references public.people(id),
  typed_name text not null check (char_length(typed_name) between 2 and 80),
  signed_at timestamptz not null default now(),
  unique (document_id, document_version, athlete_id)
);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('background_check','safesport','concussion','cpr_first_aid')),
  status text not null default 'missing' check (status in ('missing','submitted','verified','expired')),
  expires_on date,
  verified_by uuid references public.people(id),
  updated_at timestamptz not null default now(),
  unique (org_id, person_id, kind)
);

create table public.tryouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  fee_cents int not null default 0 check (fee_cents >= 0),
  rubric jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','closed','placed')),
  created_by uuid references public.people(id)
);

create table public.tryout_signups (
  id uuid primary key default gen_random_uuid(),
  tryout_id uuid not null references public.tryouts(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  signed_up_by uuid not null references public.people(id),
  status text not null default 'registered' check (status in ('registered','offered','accepted','declined','waitlisted','withdrawn')),
  created_at timestamptz not null default now(),
  unique (tryout_id, athlete_id)
);

create table public.tryout_scores (
  signup_id uuid not null references public.tryout_signups(id) on delete cascade,
  evaluator_person_id uuid not null references public.people(id),
  scores jsonb not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (signup_id, evaluator_person_id)
);

create table public.tryout_offers (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.tryout_signups(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  status text not null default 'sent' check (status in ('sent','accepted','declined','withdrawn')),
  decided_by uuid not null references public.people(id),
  jersey_request text check (jersey_request is null or char_length(jersey_request) <= 4),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index tryout_offers_live on public.tryout_offers(signup_id) where status in ('sent','accepted');

-- OpenSeason staff subscription. Separate from club fees.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id) on delete cascade,
  plan text not null default 'diy' check (plan in ('diy','staff')),
  status text not null default 'none' check (status in ('active','past_due','canceled','none')),
  current_period_end timestamptz,
  provider_ref text,
  updated_at timestamptz not null default now()
);

create or replace function app.staff_entitled(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entitlements e where e.person_id = p_person and e.plan = 'staff'
    and (e.status = 'active' or (e.status = 'past_due' and e.current_period_end > now())))
$$;

create or replace function app.invoice_visible(p_invoice uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invoices i where i.id = p_invoice and (app.is_guardian_of(i.athlete_id) or app.is_self_athlete(i.athlete_id) and (select age_band from public.athletes where id = i.athlete_id) = 'adult' or app.has_org_perm(i.org_id, 'manage_finance')))
$$;

alter table public.fee_schedules enable row level security;
alter table public.invoices enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table private.provider_events enable row level security;
alter table public.documents enable row level security;
alter table public.signatures enable row level security;
alter table public.certifications enable row level security;
alter table public.tryouts enable row level security;
alter table public.tryout_signups enable row level security;
alter table public.tryout_scores enable row level security;
alter table public.tryout_offers enable row level security;
alter table public.entitlements enable row level security;

grant select on public.fee_schedules, public.invoices, public.installments, public.payments, public.refunds, public.documents,
  public.signatures, public.certifications, public.tryouts, public.tryout_signups, public.tryout_offers, public.entitlements to authenticated;
-- tryout_scores: no client select; read through the rankings function (manage_tryouts only).

create policy fee_schedules_read on public.fee_schedules for select to authenticated using (app.has_org_perm(org_id, 'manage_finance'));
create policy invoices_read on public.invoices for select to authenticated using (app.invoice_visible(id));
create policy installments_read on public.installments for select to authenticated using (app.invoice_visible(invoice_id));
create policy payments_read on public.payments for select to authenticated using (app.invoice_visible(invoice_id));
create policy refunds_read on public.refunds for select to authenticated using (exists (select 1 from public.payments p where p.id = payment_id and app.invoice_visible(p.invoice_id)));
create policy documents_read on public.documents for select to authenticated using (app.is_org_member(org_id)
  or exists (select 1 from public.teams t where t.org_id = documents.org_id and app.is_team_family(t.id)));
create policy signatures_read on public.signatures for select to authenticated using (app.is_guardian_of(athlete_id) or signer_person_id = app.me()
  or exists (select 1 from public.documents d where d.id = document_id and app.has_org_perm(d.org_id, 'manage_compliance')));
create policy certifications_read on public.certifications for select to authenticated using (person_id = app.me() or app.has_org_perm(org_id, 'manage_compliance'));
create policy tryouts_read on public.tryouts for select to authenticated using (true);
create policy tryout_signups_read on public.tryout_signups for select to authenticated using (app.is_guardian_of(athlete_id) or exists (select 1 from public.tryouts t where t.id = tryout_id and app.has_org_perm(t.org_id, 'manage_tryouts')));
create policy tryout_offers_read on public.tryout_offers for select to authenticated using (exists (select 1 from public.tryout_signups s join public.tryouts t on t.id = s.tryout_id
  where s.id = signup_id and (app.is_guardian_of(s.athlete_id) or app.has_org_perm(t.org_id, 'manage_tryouts'))));
create policy entitlements_self on public.entitlements for select to authenticated using (person_id = app.me());

-- ---------------------------------------------------------------- fees
create or replace function public.fee_schedule_create(p_org uuid, p_team uuid, p_name text, p_kind text, p_amount_cents int, p_installments int, p_first_due date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_inv uuid; r record; base int; rem int; i int; n int := 0;
begin
  perform app.require_human();
  if not app.has_org_perm(p_org, 'manage_finance') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and org_id = p_org) then raise exception 'team is not in this club'; end if;
  insert into public.fee_schedules(org_id, team_id, name, kind, amount_cents, installments, first_due, created_by)
  values (p_org, p_team, p_name, p_kind, p_amount_cents, p_installments, p_first_due, app.me()) returning id into v;
  base := p_amount_cents / p_installments; rem := p_amount_cents - base * p_installments;
  for r in select distinct re.athlete_id from public.roster_entries re join public.teams t on t.id = re.team_id
           where t.org_id = p_org and (p_team is null or t.id = p_team) and re.status = 'active' loop
    insert into public.invoices(org_id, fee_schedule_id, athlete_id, description, amount_cents) values (p_org, v, r.athlete_id, p_name, p_amount_cents) returning id into v_inv;
    for i in 1..p_installments loop
      insert into public.installments(invoice_id, seq, amount_cents, due_on) values (v_inv, i, base + case when i = 1 then rem else 0 end, (p_first_due + make_interval(months => i - 1))::date);
    end loop;
    n := n + 1;
  end loop;
  perform app.audit('fee.create', 'fee_schedule', v::text, p_org, p_team, null, jsonb_build_object('invoices', n, 'amount_cents', p_amount_cents));
  return jsonb_build_object('fee_schedule_id', v, 'invoices', n);
end $$;

create or replace function public.my_fees() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
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
  where app.is_guardian_of(i.athlete_id) or (app.is_self_athlete(i.athlete_id) and a.age_band = 'adult')
$$;

-- Starts a provider-hosted checkout. Repeating with the same idempotency key
-- returns the same pending payment; it never creates a second charge.
create or replace function public.payment_start(p_installment uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.installments; inv public.invoices; p public.payments;
begin
  perform app.require_human();
  if char_length(p_idempotency_key) not between 16 and 80 then raise exception 'bad idempotency key'; end if;
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if p.id is not null then
    if p.initiated_by <> app.me() or p.installment_id <> p_installment then raise exception 'idempotency key reused' using errcode = '42501'; end if;
    return jsonb_build_object('payment_id', p.id, 'provider_ref', p.provider_ref, 'status', p.status, 'amount_cents', p.amount_cents, 'currency', p.currency, 'replayed', true);
  end if;
  select * into n from public.installments where id = p_installment for update;
  select * into inv from public.invoices where id = n.invoice_id;
  if n.id is null or not (app.is_guardian_of(inv.athlete_id) or (app.is_self_athlete(inv.athlete_id) and (select age_band from public.athletes where id = inv.athlete_id) = 'adult')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if n.status <> 'open' then raise exception 'this installment is not open'; end if;
  if exists (select 1 from public.payments x where x.installment_id = n.id and x.status in ('pending','uncertain')) then
    raise exception 'a payment for this installment is already in progress' using errcode = '55000'; end if;
  insert into public.payments(invoice_id, installment_id, amount_cents, currency, method, provider, provider_ref, idempotency_key, initiated_by)
  values (inv.id, n.id, n.amount_cents, inv.currency, 'provider_checkout', 'sandbox', 'sbx_cs_' || encode(extensions.gen_random_bytes(12), 'hex'), p_idempotency_key, app.me())
  returning * into p;
  perform app.audit('payment.start', 'payment', p.id::text, inv.org_id, null, null, jsonb_build_object('amount_cents', p.amount_cents));
  return jsonb_build_object('payment_id', p.id, 'provider_ref', p.provider_ref, 'status', p.status, 'amount_cents', p.amount_cents, 'currency', p.currency, 'replayed', false);
end $$;

create or replace function app.recompute_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare paid int; total int;
begin
  select amount_cents into total from public.invoices where id = p_invoice;
  select coalesce(sum(amount_cents - refunded_cents),0) into paid from public.payments where invoice_id = p_invoice and status in ('succeeded','partially_refunded','refunded');
  update public.invoices set status = case
      when paid <= 0 and exists (select 1 from public.payments where invoice_id = p_invoice and status = 'refunded') then 'refunded'
      when paid >= total then 'paid' when paid > 0 then 'partially_paid' else 'open' end,
    version = version + 1 where id = p_invoice;
end $$;

-- Applied by the verified webhook handler (service role) only. Replays of the
-- same provider event id are ignored; out-of-order failure after success is ignored.
create or replace function app.payment_apply_provider_event(p_provider text, p_event_id text, p_provider_ref text, p_outcome text) returns text
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  begin
    insert into private.provider_events(provider, event_id) values (p_provider, p_event_id);
  exception when unique_violation then return 'replay_ignored';
  end;
  select * into p from public.payments where provider_ref = p_provider_ref for update;
  if p.id is null then return 'unknown_payment'; end if;
  if p.status = 'succeeded' and p_outcome <> 'succeeded' then return 'ignored_after_success'; end if;
  if p_outcome not in ('succeeded','failed','uncertain') then raise exception 'bad outcome'; end if;
  update public.payments set status = p_outcome, updated_at = now() where id = p.id;
  if p_outcome = 'succeeded' then
    update public.installments set status = 'paid' where id = p.installment_id;
    perform app.recompute_invoice(p.invoice_id);
  end if;
  insert into public.audit_events(actor_kind, action, target_type, target_id, metadata) values ('system', 'payment.' || p_outcome, 'payment', p.id::text, jsonb_build_object('provider_event', p_event_id));
  return 'applied';
end $$;
grant execute on function app.payment_apply_provider_event(text, text, text, text) to service_role;

create or replace function public.payment_record_offline(p_installment uuid, p_method text, p_note text, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare n public.installments; inv public.invoices; v uuid;
begin
  perform app.require_human();
  select * into n from public.installments where id = p_installment for update;
  select * into inv from public.invoices where id = n.invoice_id;
  if n.id is null or not app.has_org_perm(inv.org_id, 'manage_finance') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_method not in ('offline_cash','offline_check','offline_other') then raise exception 'bad method'; end if;
  select id into v from public.payments where idempotency_key = p_idempotency_key;
  if v is not null then return v; end if;
  if n.status <> 'open' then raise exception 'this installment is not open'; end if;
  insert into public.payments(invoice_id, installment_id, amount_cents, currency, method, status, idempotency_key, initiated_by, note)
  values (inv.id, n.id, n.amount_cents, inv.currency, p_method, 'succeeded', p_idempotency_key, app.me(), p_note) returning id into v;
  update public.installments set status = 'paid' where id = n.id;
  perform app.recompute_invoice(inv.id);
  perform app.audit('payment.offline_recorded', 'payment', v::text, inv.org_id, null, p_note, jsonb_build_object('amount_cents', n.amount_cents, 'method', p_method));
  return v;
end $$;

create or replace function public.org_finance_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_org_perm(p_org, 'manage_finance') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'collected_cents', c) order by m) from (
        select to_char(date_trunc('month', p.updated_at), 'YYYY-MM') m, sum(p.amount_cents - p.refunded_cents) c
        from public.payments p join public.invoices i on i.id = p.invoice_id
        where i.org_id = p_org and p.status in ('succeeded','partially_refunded') group by 1) x), '[]'::jsonb),
    'outstanding_cents', (select coalesce(sum(n.amount_cents),0) from public.installments n join public.invoices i on i.id = n.invoice_id where i.org_id = p_org and n.status = 'open'),
    'overdue_cents', (select coalesce(sum(n.amount_cents),0) from public.installments n join public.invoices i on i.id = n.invoice_id where i.org_id = p_org and n.status = 'open' and n.due_on < current_date),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'athlete', a.first_name || ' ' || a.last_initial || '.', 'description', i.description, 'status', i.status,
         'open_cents', (select coalesce(sum(n.amount_cents),0) from public.installments n where n.invoice_id = i.id and n.status = 'open'),
         'next_open_installment', (select n.id from public.installments n where n.invoice_id = i.id and n.status = 'open' order by n.seq limit 1),
         'payments', (select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents, 'refunded_cents', p.refunded_cents, 'status', p.status, 'method', p.method)), '[]'::jsonb) from public.payments p where p.invoice_id = i.id))
         order by a.first_name) from public.invoices i join public.athletes a on a.id = i.athlete_id where i.org_id = p_org), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- forms and compliance
create or replace function public.my_forms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('document_id', d.id, 'title', d.title, 'kind', d.kind, 'version', d.version, 'body', d.body,
     'athlete_id', a.id, 'athlete', a.first_name, 'signed_at', s.signed_at) order by s.signed_at nulls first, d.title), '[]'::jsonb)
  from public.guardianships g join public.athletes a on a.id = g.athlete_id
  join public.roster_entries r on r.athlete_id = a.id and r.status <> 'removed'
  join public.teams t on t.id = r.team_id
  join public.documents d on d.org_id = t.org_id and d.required
  left join public.signatures s on s.document_id = d.id and s.document_version = d.version and s.athlete_id = a.id
  where g.guardian_person_id = app.me() and g.status = 'active'
$$;

create or replace function public.document_sign(p_document uuid, p_athlete uuid, p_typed_name text, p_document_version int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.documents; v uuid;
begin
  perform app.require_human();
  if not app.is_guardian_of(p_athlete) then raise exception 'only a guardian can sign for this athlete' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_document;
  if d.id is null then raise exception 'not found'; end if;
  if d.version <> p_document_version then raise exception 'this form was updated; review the new version before signing' using errcode = '40001'; end if;
  insert into public.signatures(document_id, document_version, athlete_id, signer_person_id, typed_name) values (p_document, d.version, p_athlete, app.me(), trim(p_typed_name))
  on conflict (document_id, document_version, athlete_id) do nothing returning id into v;
  perform app.audit('document.sign', 'document', p_document::text, d.org_id, null, null, jsonb_build_object('athlete', p_athlete, 'version', d.version));
  return v;
end $$;

create or replace function public.compliance_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_org_perm(p_org, 'manage_compliance') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'certifications', coalesce((select jsonb_agg(jsonb_build_object('person', p.display_name, 'person_id', p.id, 'kind', c.kind, 'status',
          case when c.status = 'verified' and c.expires_on < current_date then 'expired' else c.status end, 'expires_on', c.expires_on,
          'gap', c.status in ('missing','expired') or c.expires_on < current_date + 30) order by c.expires_on nulls first)
        from public.certifications c join public.people p on p.id = c.person_id where c.org_id = p_org), '[]'::jsonb),
    'unsigned_forms', coalesce((select jsonb_agg(jsonb_build_object('team', t.name, 'document', d.title, 'athlete', a.first_name || ' ' || a.last_initial || '.'))
        from public.documents d join public.teams t on t.org_id = d.org_id join public.roster_entries r on r.team_id = t.id and r.status <> 'removed'
        join public.athletes a on a.id = r.athlete_id
        where d.org_id = p_org and d.required and not exists (select 1 from public.signatures s where s.document_id = d.id and s.document_version = d.version and s.athlete_id = a.id)), '[]'::jsonb),
    'consent_pending', (select count(*) from public.consents c join public.roster_entries r on r.athlete_id = c.athlete_id join public.teams t on t.id = r.team_id
        join public.athletes a on a.id = c.athlete_id
        where t.org_id = p_org and c.kind = 'guardian_verifiable' and c.status <> 'verified' and a.age_band = 'under_13' and r.status <> 'removed')
  );
end $$;

create or replace function public.certification_set(p_org uuid, p_person uuid, p_kind text, p_status text, p_expires date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_human();
  if not (app.has_org_perm(p_org, 'manage_compliance') or (p_person = app.me() and p_status in ('submitted','missing'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.certifications(org_id, person_id, kind, status, expires_on, verified_by) values (p_org, p_person, p_kind, p_status, p_expires, case when p_status = 'verified' then app.me() end)
  on conflict (org_id, person_id, kind) do update set status = excluded.status, expires_on = excluded.expires_on, verified_by = excluded.verified_by, updated_at = now();
  perform app.audit('certification.set', 'person', p_person::text, p_org, null, null, jsonb_build_object('kind', p_kind, 'status', p_status));
end $$;

-- ---------------------------------------------------------------- tryouts (humans decide placement)
create or replace function public.tryout_create(p_org uuid, p_name text, p_starts timestamptz, p_fee_cents int, p_rubric jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_human();
  if not app.has_org_perm(p_org, 'manage_tryouts') then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.tryouts(org_id, name, starts_at, fee_cents, rubric, created_by) values (p_org, p_name, p_starts, p_fee_cents, p_rubric, app.me()) returning id into v;
  return v;
end $$;

create or replace function public.tryout_signup(p_tryout uuid, p_athlete uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; t public.tryouts;
begin
  perform app.require_human();
  if not app.is_guardian_of(p_athlete) then raise exception 'only a guardian can sign up this athlete' using errcode = '42501'; end if;
  select * into t from public.tryouts where id = p_tryout;
  if t.status <> 'open' then raise exception 'signups are closed'; end if;
  insert into public.tryout_signups(tryout_id, athlete_id, signed_up_by) values (p_tryout, p_athlete, app.me()) on conflict (tryout_id, athlete_id) do update set status = 'registered' returning id into v;
  if t.fee_cents > 0 then
    insert into public.invoices(org_id, athlete_id, description, amount_cents) values (t.org_id, p_athlete, 'Tryout fee: ' || t.name, t.fee_cents);
    insert into public.installments(invoice_id, seq, amount_cents, due_on) select id, 1, t.fee_cents, current_date from public.invoices where athlete_id = p_athlete and description = 'Tryout fee: ' || t.name order by created_at desc limit 1;
  end if;
  return v;
end $$;

create or replace function public.tryout_score(p_signup uuid, p_scores jsonb, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tryouts;
begin
  perform app.require_human();
  select tr.* into t from public.tryout_signups s join public.tryouts tr on tr.id = s.tryout_id where s.id = p_signup;
  if t.id is null or not app.has_org_perm(t.org_id, 'manage_tryouts') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_scores) <> 'object' then raise exception 'scores must be an object'; end if;
  insert into public.tryout_scores(signup_id, evaluator_person_id, scores, notes) values (p_signup, app.me(), p_scores, coalesce(p_notes,''))
  on conflict (signup_id, evaluator_person_id) do update set scores = excluded.scores, notes = excluded.notes, updated_at = now();
end $$;

create or replace function public.tryout_board(p_tryout uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tryouts;
begin
  select * into t from public.tryouts where id = p_tryout;
  if t.id is null or not app.has_org_perm(t.org_id, 'manage_tryouts') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('tryout', to_jsonb(t), 'rows', coalesce((select jsonb_agg(row_to_json(x) order by x.avg_total desc nulls last) from (
    select s.id signup_id, a.first_name || ' ' || a.last_initial || '.' athlete, s.status,
      (select round(avg((select sum(value::numeric) from jsonb_each_text(sc.scores))), 2) from public.tryout_scores sc where sc.signup_id = s.id) avg_total,
      (select count(*) from public.tryout_scores sc where sc.signup_id = s.id) evaluations,
      (select jsonb_build_object('team', tm.name, 'status', o.status, 'jersey_request', o.jersey_request) from public.tryout_offers o join public.teams tm on tm.id = o.team_id
         where o.signup_id = s.id order by o.created_at desc limit 1) offer
    from public.tryout_signups s join public.athletes a on a.id = s.athlete_id where s.tryout_id = p_tryout) x), '[]'::jsonb));
end $$;

-- Placement is a human decision. There is no automatic team picking.
create or replace function public.tryout_offer(p_signup uuid, p_team uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.tryouts; v uuid;
begin
  perform app.require_human();
  select tr.* into t from public.tryout_signups s join public.tryouts tr on tr.id = s.tryout_id where s.id = p_signup;
  if t.id is null or not app.has_org_perm(t.org_id, 'manage_tryouts') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = p_team and org_id = t.org_id) then raise exception 'team is not in this club'; end if;
  insert into public.tryout_offers(signup_id, team_id, decided_by) values (p_signup, p_team, app.me()) returning id into v;
  update public.tryout_signups set status = 'offered' where id = p_signup;
  perform app.audit('tryout.offer', 'tryout_signup', p_signup::text, t.org_id, p_team);
  return v;
end $$;

create or replace function public.tryout_offer_respond(p_offer uuid, p_accept boolean, p_jersey text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.tryout_offers; s public.tryout_signups;
begin
  perform app.require_human();
  select * into o from public.tryout_offers where id = p_offer for update;
  select * into s from public.tryout_signups where id = o.signup_id;
  if o.id is null or not app.is_guardian_of(s.athlete_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if o.status <> 'sent' then raise exception 'offer is no longer open'; end if;
  update public.tryout_offers set status = case when p_accept then 'accepted' else 'declined' end, jersey_request = p_jersey, responded_at = now() where id = p_offer;
  update public.tryout_signups set status = case when p_accept then 'accepted' else 'declined' end where id = s.id;
  if p_accept then
    insert into public.roster_entries(team_id, athlete_id, jersey, status, added_by)
    select o.team_id, s.athlete_id, p_jersey, case when a.age_band = 'under_13' and not exists (select 1 from public.consents c where c.athlete_id = a.id and c.kind = 'guardian_verifiable' and c.status = 'verified') then 'invited' else 'active' end, app.me()
    from public.athletes a where a.id = s.athlete_id on conflict do nothing;
    update public.teams set roster_version = roster_version + 1 where id = o.team_id;
  end if;
end $$;

create or replace function public.my_tryouts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'starts_at', t.starts_at, 'fee_cents', t.fee_cents, 'club', o.name))
             from public.tryouts t join public.organizations o on o.id = t.org_id where t.status = 'open'), '[]'::jsonb),
    'signups', coalesce((select jsonb_agg(jsonb_build_object('signup_id', s.id, 'tryout', t.name, 'athlete', a.first_name, 'status', s.status,
             'offer', (select jsonb_build_object('id', o.id, 'team', tm.name, 'status', o.status) from public.tryout_offers o join public.teams tm on tm.id = o.team_id where o.signup_id = s.id and o.status in ('sent','accepted') limit 1)))
             from public.tryout_signups s join public.tryouts t on t.id = s.tryout_id join public.athletes a on a.id = s.athlete_id where app.is_guardian_of(s.athlete_id)), '[]'::jsonb)
  )
$$;

create or replace function public.my_entitlement() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan', coalesce(e.plan, 'diy'), 'status', coalesce(e.status, 'none'), 'current_period_end', e.current_period_end, 'staff_enabled', app.staff_entitled(app.me()))
  from (select 1) one left join public.entitlements e on e.person_id = app.me()
$$;

-- Subscription changes arrive only from the billing provider (service role).
create or replace function app.entitlement_apply_provider_event(p_provider text, p_event_id text, p_person uuid, p_plan text, p_status text, p_period_end timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  begin insert into private.provider_events(provider, event_id) values (p_provider, p_event_id);
  exception when unique_violation then return 'replay_ignored'; end;
  insert into public.entitlements(person_id, plan, status, current_period_end) values (p_person, p_plan, p_status, p_period_end)
  on conflict (person_id) do update set plan = excluded.plan, status = excluded.status, current_period_end = excluded.current_period_end, updated_at = now();
  insert into public.audit_events(actor_kind, actor_person_id, action, target_type, target_id, metadata) values ('system', null, 'entitlement.' || p_status, 'person', p_person::text, jsonb_build_object('plan', p_plan));
  return 'applied';
end $$;
grant execute on function app.entitlement_apply_provider_event(text, text, uuid, text, text, timestamptz) to service_role;
