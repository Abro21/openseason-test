# OpenSeason

Club management for youth sports (free DIY tools for clubs, teams and families) with optional paid staff that prepare work for people to approve. One app, many contexts: the same person can be a parent on one team, a coach on another and a director of a club.

**Status: prototype, sandbox only.** Synthetic data, sandbox payment/delivery providers, local sign-in with synthetic personas. Not production-ready, not legally reviewed, not store-submitted. See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for what is implemented, partial, sandboxed, blocked or deferred.

> This repository was started fresh because the foundation repository (`open-season/openseason`) was not readable from the build environment. Porting this work onto that foundation is a follow-up; see the limitations section of the implementation doc.

## Layout

| Path | What it is |
| --- | --- |
| `supabase/migrations` | Postgres schema, row-level security, and every write as a security-definer RPC |
| `supabase/seed/seed.sql` | Synthetic people, clubs, teams, events and fees (no real data) |
| `supabase/tests/local_supabase_shim.sql` | Roles and `auth.*` functions so plain Postgres behaves like Supabase for tests. Never apply to hosted Supabase |
| `packages/tokens` | Design tokens (colour, type, space, radius, motion); web CSS variables and mobile styles both come from here |
| `packages/domain` | Portable rules: staff roles, action states, age bands, schedule, money, messaging |
| `packages/contracts` | Client-callable RPC allowlist and zod response schemas |
| `packages/api-client` | Typed client, transports (supabase-js or dev gateway), identity- and context-scoped cache |
| `packages/db` | Seed ids and the database policy/journey test suite |
| `tools/dev-gateway` | Local-only HTTP gateway: persona sign-in, per-request DB identity, sandbox checkout and webhooks, sandbox delivery/refund workers, fixed sandbox staff replies |
| `apps/web` | React + Vite web app (Staff Room split desk, family, coach, club, messages) |
| `apps/mobile` | Expo React Native app with native screens |

## Run it locally

Requirements: Node 22, pnpm 10, Postgres 16 with `psql` on the PATH, listening on localhost.

```bash
pnpm install
pnpm db:reset          # creates openseason_local from migrations + synthetic seed
pnpm dev:gateway       # http://localhost:8787
pnpm dev:web           # http://localhost:5173
```

Sign in as any synthetic person on the web sign-in screen. Useful ones: Pat Parent (guardian of two children on two teams), Casey Coach (head coach, Staff plan), Dana Director (club owner, Staff plan), Jordan Multi (coach on one team and parent on another, free tools only), Gail Fan (invited fan).

Mobile: `cd apps/mobile && pnpm start`, then open in Expo Go or a development build. Set `EXPO_PUBLIC_GATEWAY_URL` to an address the device can reach (Android emulator: `http://10.0.2.2:8787`). See [docs/NATIVE_BUILDS.md](docs/NATIVE_BUILDS.md).

## Checks

```bash
pnpm turbo run lint typecheck test   # lint, types, unit and component tests
pnpm test:db                          # resets the DB, then policy, journey and gateway tests
pnpm --filter @openseason/web build
pnpm --filter @openseason/mobile export:check   # Metro JS bundles only, not a native build
```

CI runs the same commands against a Postgres 16 service (`.github/workflows/ci.yml`).

## More

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md): requirements matrix, evidence, limitations
- [docs/SECURITY.md](docs/SECURITY.md): authorization model, assumptions, residual risks
- [docs/POLICY_QUESTIONS.md](docs/POLICY_QUESTIONS.md): decisions the product owner needs to make
- [docs/DEMO.md](docs/DEMO.md): demo script for parent, coach, director, context switching and staff approval
- [docs/NATIVE_BUILDS.md](docs/NATIVE_BUILDS.md): native build and internal distribution steps
