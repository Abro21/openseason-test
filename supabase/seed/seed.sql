-- Synthetic seed data. Every name, email and organization here is invented.
-- Emails use the reserved example.test domain. No production data.
--
-- IDs are fixed so tests and the demo script can refer to them:
--   people   00000000-0000-4000-8000-0000000001NN
--   auth     00000000-0000-4000-8000-0000000002NN
--   athletes 00000000-0000-4000-8000-0000000003NN
--   orgs     00000000-0000-4000-8000-0000000004NN
--   teams    00000000-0000-4000-8000-0000000005NN
--   other    00000000-0000-4000-8000-0000000006NN+

begin;

insert into auth.users(id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000201', 'dana.director@example.test', now()),
  ('00000000-0000-4000-8000-000000000202', 'casey.coach@example.test', now()),
  ('00000000-0000-4000-8000-000000000203', 'alex.assistant@example.test', now()),
  ('00000000-0000-4000-8000-000000000204', 'pat.parent@example.test', now()),
  ('00000000-0000-4000-8000-000000000205', 'leo.athlete@example.test', now()),
  ('00000000-0000-4000-8000-000000000206', 'gail.fan@example.test', now()),
  ('00000000-0000-4000-8000-000000000207', 'jordan.multi@example.test', now()),
  ('00000000-0000-4000-8000-000000000208', 'riley.parent@example.test', now()),
  ('00000000-0000-4000-8000-000000000209', 'olivia.other@example.test', now()),
  ('00000000-0000-4000-8000-000000000210', 'sam.safeguard@example.test', now()),
  ('00000000-0000-4000-8000-000000000211', 'quinn.newcomer@example.test', now());

insert into public.people(id, auth_user_id, display_name, email) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'Dana Director', 'dana.director@example.test'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'Casey Coach', 'casey.coach@example.test'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000203', 'Alex Assistant', 'alex.assistant@example.test'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000204', 'Pat Parent', 'pat.parent@example.test'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000205', 'Leo Lopez', 'leo.athlete@example.test'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000206', 'Gail Fan', 'gail.fan@example.test'),
  ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000207', 'Jordan Multi', 'jordan.multi@example.test'),
  ('00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000208', 'Riley Parent', 'riley.parent@example.test'),
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000209', 'Olivia Other', 'olivia.other@example.test'),
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000210', 'Sam Safeguard', 'sam.safeguard@example.test'),
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000211', 'Quinn Newcomer', 'quinn.newcomer@example.test');

insert into public.organizations(id, name, timezone, created_by) values
  ('00000000-0000-4000-8000-000000000401', 'Front Range FC', 'America/Denver', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000402', 'Mesa Valley SC', 'America/Denver', '00000000-0000-4000-8000-000000000109');

insert into public.org_grants(org_id, person_id, permission, granted_by) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000101', 'owner', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000110', 'review_safeguarding', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000109', 'owner', '00000000-0000-4000-8000-000000000109');

insert into public.seasons(id, org_id, name, starts_on, ends_on, status) values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000401', 'Fall 2026', '2026-08-15', '2026-12-15', 'active'),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000402', 'Fall 2026', '2026-08-15', '2026-12-15', 'active');

insert into public.teams(id, org_id, season_id, name, sport, age_group, timezone, created_by) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000601', 'U12 Blue', 'soccer', 'U12', 'America/Denver', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000601', 'U15 Red', 'soccer', 'U15', 'America/Denver', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000602', 'U12 Gold', 'soccer', 'U12', 'America/Denver', '00000000-0000-4000-8000-000000000109');

insert into public.team_staff(team_id, person_id, role, granted_by) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000102', 'head_coach', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000103', 'assistant_coach', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000107', 'head_coach', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000109', 'head_coach', '00000000-0000-4000-8000-000000000109');

-- Athletes. Only first name and last initial are stored on the athlete; the
-- date of birth lives in private.athlete_dob.
insert into public.athletes(id, person_id, first_name, last_initial, age_band, created_by) values
  ('00000000-0000-4000-8000-000000000301', null, 'Mia', 'L', 'under_13', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000105', 'Leo', 'L', 'teen', '00000000-0000-4000-8000-000000000107'),
  ('00000000-0000-4000-8000-000000000303', null, 'Ava', 'M', 'under_13', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000304', null, 'Noah', 'P', 'under_13', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000305', null, 'Zoe', 'O', 'under_13', '00000000-0000-4000-8000-000000000109');

insert into private.athlete_dob(athlete_id, dob) values
  ('00000000-0000-4000-8000-000000000301', '2015-03-10'),
  ('00000000-0000-4000-8000-000000000302', '2012-05-02'),
  ('00000000-0000-4000-8000-000000000303', '2015-08-20'),
  ('00000000-0000-4000-8000-000000000304', '2015-01-15'),
  ('00000000-0000-4000-8000-000000000305', '2015-06-01');

insert into public.guardianships(athlete_id, guardian_person_id, status, approved_by, approved_at) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000104', 'active', '00000000-0000-4000-8000-000000000102', now()),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000104', 'active', '00000000-0000-4000-8000-000000000107', now()),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000107', 'active', '00000000-0000-4000-8000-000000000102', now()),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000108', 'active', '00000000-0000-4000-8000-000000000102', now()),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000109', 'active', '00000000-0000-4000-8000-000000000109', now());

-- Verifiable guardian consent. Noah's is still pending, so he stays "invited".
-- The provider refs are sandbox placeholders, not real verifications.
insert into public.consents(athlete_id, kind, status, method, provider_ref, granted_by) values
  ('00000000-0000-4000-8000-000000000301', 'guardian_verifiable', 'verified', 'provider_verified', 'sandbox_vc_mia', '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000303', 'guardian_verifiable', 'verified', 'in_person_verified', null, '00000000-0000-4000-8000-000000000107'),
  ('00000000-0000-4000-8000-000000000304', 'guardian_verifiable', 'pending', null, null, '00000000-0000-4000-8000-000000000108'),
  ('00000000-0000-4000-8000-000000000305', 'guardian_verifiable', 'verified', 'provider_verified', 'sandbox_vc_zoe', '00000000-0000-4000-8000-000000000109');

insert into public.roster_entries(team_id, athlete_id, jersey, status, added_by) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000301', '7', 'active', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000302', '10', 'active', '00000000-0000-4000-8000-000000000107'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000303', '4', 'active', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000304', null, 'invited', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000305', '9', 'active', '00000000-0000-4000-8000-000000000109');

insert into public.fan_follows(athlete_id, team_id, fan_person_id, invited_by) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000104');

-- Schedule: weekly practices and a Saturday game, relative to the seed date.
insert into public.events(id, team_id, kind, title, opponent, starts_at, ends_at, location, created_by)
select ('00000000-0000-4000-8000-0000000007' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-4000-8000-000000000501', 'practice', 'Practice', null,
       date_trunc('day', now()) + (g * 7 + 2) * interval '1 day' + interval '24 hours',
       date_trunc('day', now()) + (g * 7 + 2) * interval '1 day' + interval '25 hours 30 minutes',
       'Field 3, Clement Park (synthetic)', '00000000-0000-4000-8000-000000000102'
from generate_series(1, 4) g;

insert into public.events(id, team_id, kind, title, opponent, starts_at, ends_at, location, created_by) values
  ('00000000-0000-4000-8000-000000000710', '00000000-0000-4000-8000-000000000501', 'game', 'League game', 'Lakewood United',
   date_trunc('day', now()) + interval '5 days 16 hours', date_trunc('day', now()) + interval '5 days 17 hours 30 minutes', 'Field 1, Clement Park (synthetic)', '00000000-0000-4000-8000-000000000102'),
  ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000502', 'game', 'League game', 'Golden Rush',
   date_trunc('day', now()) + interval '5 days 19 hours', date_trunc('day', now()) + interval '5 days 20 hours 30 minutes', 'Field 2, Clement Park (synthetic)', '00000000-0000-4000-8000-000000000107'),
  ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000503', 'practice', 'Practice', null,
   date_trunc('day', now()) + interval '3 days 23 hours', date_trunc('day', now()) + interval '4 days 30 minutes', 'Mesa Park (synthetic)', '00000000-0000-4000-8000-000000000109');

insert into public.game_scores(event_id) values ('00000000-0000-4000-8000-000000000710'), ('00000000-0000-4000-8000-000000000711');

insert into public.rsvps(event_id, athlete_id, status, responded_by, via) values
  ('00000000-0000-4000-8000-000000000710', '00000000-0000-4000-8000-000000000303', 'yes', '00000000-0000-4000-8000-000000000107', 'app');

insert into public.event_assignments(id, event_id, kind, label, slots, created_by) values
  ('00000000-0000-4000-8000-000000000720', '00000000-0000-4000-8000-000000000710', 'snack', 'Halftime oranges', 1, '00000000-0000-4000-8000-000000000102');

-- Fees: U12 Blue registration, $450 in 3 installments.
insert into public.fee_schedules(id, org_id, team_id, name, kind, amount_cents, installments, first_due, created_by) values
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000501', 'Fall registration', 'installment_plan', 45000, 3, current_date + 10, '00000000-0000-4000-8000-000000000101');

insert into public.invoices(id, org_id, fee_schedule_id, athlete_id, description, amount_cents) values
  ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000301', 'Fall registration', 45000),
  ('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000303', 'Fall registration', 45000);

insert into public.installments(invoice_id, seq, amount_cents, due_on)
select inv, s, 15000, current_date + 10 + (s - 1) * 30
from (values ('00000000-0000-4000-8000-000000000811'::uuid), ('00000000-0000-4000-8000-000000000812'::uuid)) v(inv), generate_series(1, 3) s;

insert into public.documents(id, org_id, kind, title, body, version, required) values
  ('00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000401', 'waiver', 'Participation waiver',
   'Sample waiver text for local development only. This is not legal language.', 1, true),
  ('00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000401', 'code_of_conduct', 'Family code of conduct',
   'Sample code of conduct for local development only.', 1, true);

insert into public.signatures(document_id, document_version, athlete_id, signer_person_id, typed_name) values
  ('00000000-0000-4000-8000-000000000821', 1, '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000104', 'Pat Parent');

insert into public.certifications(org_id, person_id, kind, status, expires_on, verified_by) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000102', 'background_check', 'verified', current_date + 300, '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000102', 'safesport', 'verified', current_date + 20, '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000103', 'safesport', 'missing', null, null);

insert into public.tryouts(id, org_id, name, starts_at, fee_cents, rubric, created_by) values
  ('00000000-0000-4000-8000-000000000831', '00000000-0000-4000-8000-000000000401', 'Spring 2027 U13 tryouts',
   date_trunc('day', now()) + interval '21 days 17 hours', 2500,
   '["first_touch","passing","vision","effort"]'::jsonb, '00000000-0000-4000-8000-000000000101');

-- Staff plan entitlements (sandbox). Casey and Dana have staff; Jordan is on
-- the free tools; Pat has no plan.
insert into public.entitlements(person_id, plan, status, current_period_end, provider_ref) values
  ('00000000-0000-4000-8000-000000000102', 'staff', 'active', now() + interval '20 days', 'sandbox_sub_casey'),
  ('00000000-0000-4000-8000-000000000101', 'staff', 'active', now() + interval '20 days', 'sandbox_sub_dana'),
  ('00000000-0000-4000-8000-000000000107', 'diy', 'active', null, null);

insert into public.notification_prefs(person_id, quiet_start, quiet_end, timezone) values
  ('00000000-0000-4000-8000-000000000104', '21:00', '07:00', 'America/Denver');

commit;
