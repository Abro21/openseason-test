# Implementation status

Prototype built on 2026-11-07 in a fresh repository (`abro21/openseason-test`). Everything runs against synthetic data and sandbox providers. Nothing here is production-ready, legally reviewed or store-approved.

Status words:

- **Implemented**: built end to end (database, API, at least one client) and covered by tests.
- **Partial**: the database and tests exist, but a client screen or part of the behaviour is missing.
- **Sandboxed**: the real flow runs, but against a local sandbox provider rather than a real one.
- **Blocked**: needs something outside this repository (an account, a source, a decision).
- **Deferred**: deliberately not built in this run.

## Sources that were not available

| Source | Status |
| --- | --- |
| Foundation repo `open-season/openseason` (David's) | Not readable: the connected GitHub account has no access. This repo is a fresh monorepo. Porting onto the foundation is a follow-up, not done here. |
| PRD (Google Doc) | Not readable from this environment. Requirements come from the build brief only. |
| Figma file | Not readable. The design system is built from the brief's token description, not from Figma frames. |
| Lovable prototype | Not imported (the brief says not to bulk-import). Not used as a reference. |
| Marketing site | Not used. |

## Requirements matrix

### §1 Design system

| Requirement | Status | Evidence |
| --- | --- | --- |
| Shared tokens (colour, type, space, radius, motion), light and dark | Implemented | `packages/tokens`, 10 unit tests; web CSS variables via `apps/web/src/theme.ts`, mobile via `apps/mobile/src/ui.tsx` |
| Accessible components (labels, focus, 44pt targets, status roles) | Partial | axe checks on the coach home with an open staff draft, and on sign-in, in `apps/web/src/app.test.tsx` (colour-contrast rule disabled under jsdom, so contrast is not verified); mobile buttons are 44pt |
| Figma parity | Blocked | Figma unreadable |

### §4 Identity, contexts and claims

| Requirement | Status | Evidence |
| --- | --- | --- |
| One person, many roles (club director, coach, parent, player, fan), in one club or several, as in the Lovable prototype | Implemented | `my_tenants` lists every club with the person's roles and scopes in each; tenancy test "lists every club a person belongs to, with their roles and scopes in each" (Jordan coach and parent, Olivia director and coach, Pat parent in two clubs); web Role switcher plus a second switcher for the club, team or child, like the prototype's ModeSwitcher and team/child switchers; mobile role and club picker |
| Each club is its own tenant: data is read inside one club at a time, and a team without a club is its own tenant | Implemented | migration `20261109000600_tenancy.sql`: `app.require_tenant` refuses a club the person does not belong to; `my_contexts`, `my_fees`, `my_forms`, `my_conversations`, `dm_start`, `staff_room` and `staff_run_triggers` all take the club; tenancy tests "refuses a club the person does not belong to, whatever id the client sends", "keeps conversations in the club they belong to"; the client cache is keyed by person, club and role, so switching never shows another club's data. Direct messages created before this migration have no club and are not listed |
| Claims need a valid invite token plus staff approval; email match is only a hint | Implemented | identity tests for token, conflict, self-approval, rate limit; web `Claim` screen |
| Under-13 athletes inactive until verifiable guardian consent | Sandboxed | sandbox provider callback records `provider_verified`; identity test; real provider is policy question 8 |
| Revoking access takes effect immediately, including fan follows | Implemented | identity tests "removes access as soon as a grant is revoked", "revoking a guardian also ends the fan follows" |
| Apple and Google sign-in | Blocked | dev gateway uses synthetic personas only; hosted Supabase Auth not configured |
| Coach-sent invites UI | Partial | `invite_create` / `invite_revoke` RPCs exist; no client screen |

### §5 Table stakes

| Area | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| Parent | Schedule across children, RSVP per child | Implemented | schedule tests; web `FamilySchedule`, mobile Schedule |
| Parent | Forms: sign current version with typed name | Implemented | test "signs the current version of a form only"; web `FamilyForms` |
| Parent | Fees: see own children's fees, pay via hosted checkout | Sandboxed | tests for fee visibility, installments, idempotent checkout, webhook replay; sandbox checkout page collects no card |
| Parent | Assignments and snack signups | Partial | `assignment_create` / `assignment_signup` RPCs; no client screen |
| Coach | Recurring practices, edits with version check, DST-safe | Implemented | schedule tests "creates recurring practices at the same local time across the DST change", "rejects a stale edit" |
| Coach | Attendance | Implemented | `attendance_record`; web Team screen |
| Coach | Live scoring with delegation and stale-device rejection | Implemented | schedule test; web Scoring, mobile Scorer |
| Coach | RSVP summary | Implemented | test "gives staff an RSVP summary"; web Team screen |
| Coach | Practice planning | Implemented | `practice_plan_save` / `practice_plan_get`; plan editor opens from the practice on the coach's schedule |
| Director | Finance summary, offline payments with audit | Implemented | `org_finance_summary`, test "requires finance permission to record an offline payment"; web Club screen |
| Director | Compliance and certification gaps | Implemented | test "shows the director certification gaps"; web Club screen states it does not certify anything |
| Director | Tryouts from signup to accepted offer | Partial | journey and schedule tests; no client screen |
| Director | Refunds | Partial | `refund` pending action with refundable-amount check and honest `uncertain` state (tests); sandbox refund worker; no refund screen |
| Director | Club values / playbook | Deferred | not modelled |
| Director | Season close and archive | Deferred | `seasons` and `programs` tables exist; no close or archive (policy question 7) |
| Athlete | Teen manages own schedule and RSVPs | Implemented | test "lets a teen RSVP for themselves"; journey 4 |
| Athlete | Captain election, rostered athletes only | Partial | `poll_create` / `poll_vote`, test "limits captain elections to athletes on the roster"; no client screen; voter rule is policy question 2 |
| Fan | Schedule and results only, removable | Implemented | test "shows a fan the schedule without location or RSVPs"; journey 5 |
| Fan | Lock-screen live scores, realtime | Deferred | no realtime subscriptions built |
| Messaging | Team chat, DMs between adults sharing a team, announcements-only mode | Implemented | messaging tests; web and mobile Messages |
| Messaging | No private adult–minor DMs | Implemented | test "never opens a private conversation between an adult and a minor" |
| Messaging | Moderation filter and queue | Implemented | test "holds messages that trip the filter until a moderator decides"; no moderator screen |
| Messaging | Quiet hours with emergency override | Implemented | test "defers push and SMS in quiet hours"; notification prefs have no client screen |
| Messaging | SMS Y/N replies through scoped tokens | Sandboxed | test "applies Y/N replies through a scoped token"; delivery is sandbox only |
| Messaging | Dictation | Partial | works through the OS keyboard; `input_mode` is always recorded as `typed` |
| Feedback | Surveys with small-group suppression | Partial | test "suppresses survey results below five responses"; no client screen |
| Safeguarding | Issue reports, anonymous identity resolvable only by a safeguarding grant, always audited | Partial | tests; no client screen; ownership is policy question 6 |
| Billing | Card processing fee treatment | Blocked | module supports payer or club pays; no rate configured (policy question 4) |
| Billing | Imports, scholarships, emergency and medical fields | Deferred | not modelled (policy question 10) |

### §6 Staff (prepared work inside each task)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Four roles: Player Development Coach, Practice Prep Coach, DOBO, Admin, with renamable titles | Implemented | `packages/domain` `STAFF_ROLES`, `staff_title_set`; preparing role labelled on approved work (actions test) |
| Staff prepare only from what the person may see; needs an active Staff plan | Implemented | actions tests "prepares only from what the person may see", "only with an active staff plan" |
| Prepared work kinds: practice plan, attendance reminder, fee reminder, certification nudge, player feedback, announcement | Implemented | `staff_prepare`; actions tests |
| Durable, deduplicated, owner-private prepared work | Implemented | actions test |
| Staff thread with paging | Implemented | actions test; web `StaffThread` "Fetch more" |
| Staff replies | Sandboxed | fixed sandbox reply labelled as such; no AI provider configured |
| Staff work happens inside each task, not in a separate section | Implemented | web `apps/web/src/staff.tsx`: overdue-fee reminders on Payments, certification nudges on Compliance, an RSVP reminder on the game it is for and a practice plan on the next practice (Schedule), the week-ahead announcement in the team conversation (Messages), and "Waiting on you" with batch approval on the club and coach home; app test "puts the RSVP reminder on the game it is for, not in a separate section"; mobile shows the same drafts on Home and under each event |
| Staff look for work on their own, as the person, inside each club, at most hourly, drafts only | Sandboxed | `runStaffRoutines` in `packages/sandbox` runs in the gateway loop and the in-browser sandbox; gateway test "runs staff routines as each planholder, inside each club, as drafts only"; sandbox test "has staff prepare routine drafts on their own" |
| Losing the Staff plan keeps every DIY record and tool | Implemented | actions test "re-checks the staff plan at execution"; DIY RPCs have no entitlement check |
| Staff plan pricing and purchase | Blocked | entitlement only, no price or purchase flow (policy question 5) |

### §7 Approval and execution

| Requirement | Status | Evidence |
| --- | --- | --- |
| Staff runtime can never approve, sign, pay, vote or post to members | Implemented | `app.require_human()`; actions test "never lets the staff runtime approve" |
| Approve the exact revision and payload hash, idempotently | Implemented | actions tests; web test "Approve sends p_expected_revision 3 / hash-v3" |
| Stale revision rejected and shown as changed | Implemented | actions test; web test shows "This changed since you opened it" |
| Recipients can be removed, never added, after review | Implemented | actions test; web MessageEditor only removes |
| Re-check grants, consent, entitlement and freshness at execution | Implemented | actions tests for revoked grant and lost plan |
| Needs refresh when sources change | Implemented | actions test |
| Reject, retry (new revision), end | Implemented | actions test; web ActionPanel |
| Batch approval with per-item results | Implemented | actions test; web batch selection |
| Exactly-once send under concurrent approvals and workers | Implemented | test "lets only one of two simultaneous approvals win, and two workers send once" |

### §8 Backend security

See [SECURITY.md](SECURITY.md). Every item there has a test in `packages/db/test` except the residual risks listed at its end.

### §9 Native mobile

| Requirement | Status | Evidence |
| --- | --- | --- |
| Expo React Native app with native screens (no web wrapper, no Capacitor) | Implemented | `apps/mobile`; JS bundles built for Android and iOS (see commands) |
| Token in OS keychain/keystore | Implemented | `expo-secure-store` |
| Native build on a device or simulator | Blocked | not attempted: no Xcode, Android SDK or EAS account in this environment. A JS bundle export is not a native build. |
| Deep links and push notifications | Deferred | scheme `openseason` declared; no routing or push registration |
| Native tab navigation | Partial | custom tab bar, not a navigation library |

### §10 Journeys

All five run as database tests in `packages/db/test/journeys.test.ts`:

1. A new parent joins, gets verified consent, RSVPs, signs forms and pays.
2. A coach plans practice with staff help, takes attendance, reminds families and scores the game.
3. A director runs fees, compliance and tryouts, approving staff work in a batch.
4. A teen athlete manages their own schedule, votes, and is protected from private adult messages.
5. A fan follows one athlete, sees limited information, and loses access when removed.

These exercise the database through the same RPCs the clients call. They are not browser or device tests.

## Commands run and results

Run on 2026-11-08 in the build environment (Node 22, pnpm 10, Postgres 16 local).

| Command | Result |
| --- | --- |
| `pnpm turbo run lint typecheck test` | 26 of 26 tasks successful. Unit tests: tokens 10, domain 20, api-client 7, dev-gateway 3, web 10 (5 component tests, 4 in-browser sandbox tests, 1 full-app sandbox test) |
| `pnpm test:db` | db package: 6 files, 71 tests passed. dev-gateway: 2 files, 7 tests passed (4 database tests plus the 3 crypto tests, which the filter also matches) |
| `pnpm --filter @openseason/web build` | Succeeded, 251 kB JS (75 kB gzip) |
| `pnpm --filter @openseason/web build:sandbox` | Succeeded. Adds a lazily loaded 632 kB sandbox chunk and PGlite's files (8.9 MB WebAssembly, 4.9 MB data, 1.1 MB pgcrypto), about 15 MB in all |
| `vite preview` of the sandbox build, fetched with curl | Index and every sandbox asset served; the WebAssembly as `application/wasm` |
| `pnpm --filter @openseason/mobile export:check` | Succeeded: Android bundle 581 modules, iOS bundle 556 modules, Hermes bytecode. This is a JS bundle check only |
| Live smoke on 2026-11-07: gateway plus Vite dev server | Health ok; CORS header for `http://localhost:5173`; prepare → propose → approve → worker reached `succeeded`; sandbox deliveries recorded (3 email, 3 push); Vite served the app |

The in-browser sandbox tests run the real migrations and seed in PGlite and check: sign-in refusals, row-level security (a person with no team gets `42501`), a sandbox payment marking an installment paid, and staff work going from prepare to approve to `succeeded`, with the labelled sandbox staff reply. The full-app test renders the web app in sandbox mode under jsdom, signs in as Pat Parent, sees both children and pays through the stand-in checkout.

Not verified:

- The web UI rendered in a real browser (only jsdom component tests and a served index). No browser is available in the build environment.
- The sandbox build deployed anywhere, or loading at fresh.openseason.org.
- Any native iOS or Android build.
- Hosted Supabase, PostgREST argument coercion, realtime.
- CI on GitHub (the workflow exists but has not run, because the branch could not be pushed).

## Environment variables

Names only, in [`.env.example`](../.env.example). Local defaults: `DATABASE_URL`, `GATEWAY_PORT`, `GATEWAY_ALLOWED_ORIGINS`, `SANDBOX_REFUND_OUTCOME`, `VITE_GATEWAY_URL`, `EXPO_PUBLIC_GATEWAY_URL`. The gateway generates its JWT and webhook secrets per process unless they are set. Hosted secret names are listed there commented out; no real credentials exist in this repository.

## Known limitations

- Fresh repository, not built on David's foundation. Porting is a follow-up.
- Requirements come from the brief alone; the PRD and Figma were not read.
- The dev gateway is local-only and is not a production server.
- The hosted demo build runs the database in each visitor's browser: data is per browser and is not shared between people.
- Client screens are missing for tryouts, polls and elections, surveys, assignments and snacks, issue reports, coach invites, moderation and notification preferences, even where the database and tests exist.
- No realtime, storage buckets or search.
