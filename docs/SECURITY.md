# Security model

## Authorization lives in the database

- Every table has row-level security enabled (checked: no `public` table lacks RLS). Clients hold `SELECT`-only grants on a small set of views/tables; all writes go through `security definer` RPCs with `search_path = ''`.
- The acting person comes only from the verified token (`auth.uid()` → `app.me()`). No RPC takes a person, approver or guardian id from the client as proof of anything; forged ids are tested to fail.
- The staff runtime acts *as the person* with an extra `os_actor = 'agent'` claim. `app.require_human()` blocks agents from approving, signing, paying, voting and posting to members. The dev gateway never mints the agent claim for client requests; only its server-side staff worker does.
- Service-only functions (`app.*` webhooks, workers, reconciliation) check `auth.role() = 'service_role'` and are not executable by `authenticated` or `anon`. A contract test asserts that the client allowlist equals exactly the functions `authenticated` can execute, and that `anon` can execute none.
- Pending Actions are approved against an exact `revision` and `payload_hash`, with an idempotency key. At execution the database re-checks the approver's grants, consent, entitlement and source freshness as the approver, using `for update skip locked`. Recipients can only shrink after review. Outbox rows are deduplicated by key.

## Minors and private data

- Dates of birth live in `private.athlete_dob`, readable only through a narrow function for guardians and authorized staff.
- Under-13 athletes stay inactive until verifiable guardian consent is recorded by the (sandboxed) provider path; a checkbox is not accepted as proof.
- Adult–minor private DMs are refused in the database. Teens cannot post anonymously. Anonymous survey/issue identity lives in `private.*` and can be resolved only by a safeguarding grant, with a reason and an audit event, including for denied attempts.
- Fans see schedule and results only: no locations, RSVPs, roster or contact details.

## Payments and providers

- No card data is collected or stored. Checkout is provider-hosted (sandbox page in development). Webhooks are HMAC-verified and replay-protected by provider event id. Uncertain refunds stay `uncertain` until reconciled; they are never retried blindly.
- AI subscription entitlements are separate from club/family payments. Losing the Staff plan blocks staff preparation and execution of staff work, but keeps every DIY record and tool.

## Clients

- Tokens: web keeps the dev token in `sessionStorage` (dev only); mobile keeps it in the OS keychain/keystore via `expo-secure-store`.
- The API client caches reads per person and context and clears on sign-out or context change. Writes clear the cache.
- Unknown RPC names and arguments are refused client-side and again by the gateway; the database enforces the rest.

## The dev gateway is not a production server

`tools/dev-gateway` refuses non-local databases, signs short-lived HS256 tokens with a per-process random secret and offers password-less sign-in as synthetic personas. Hosted environments must use Supabase Auth (Apple and Google sign-in per the PRD) and PostgREST/Edge Functions instead.

## Residual risks and assumptions

- Hosted Supabase was not exercised. Tests ran on plain Postgres 16 with a shim for Supabase roles and `auth.*` functions; behaviour on hosted Supabase (PostgREST argument coercion, realtime) needs a staging run.
- No realtime subscriptions, storage buckets or search indexes exist yet, so their authorization is untested because they are not built.
- Rate limits exist for claims and staff messages only.
- The sandbox staff responder is a fixed reply. A real model provider needs the same tool-argument validation, data minimisation and retention review before use; no claim is made about provider training or retention.
- No penetration test, legal review, COPPA or SafeSport certification. Application controls alone do not establish compliance.
