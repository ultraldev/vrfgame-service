# VRF Game Service — Project Rules

This repository is the standalone Fastify replacement for the legacy NestJS API in `vrfgame/apps/api`. It is intentionally a single repository, not a monorepo. The frontend will also be rebuilt, so do not preserve legacy endpoint names or response shapes unless the task explicitly asks for compatibility.

Do not reintroduce NestJS. Migrate the legacy API incrementally into this service.

## Stack

- Node.js 24, ESM, pnpm
- Fastify 5
- Drizzle ORM + PostgreSQL 17
- Redis 7
- Better Auth
- Zod 4 with `fastify-type-provider-zod`
- Vitest
- Ultracite with Oxlint and Oxfmt

## Common Commands

```bash
pnpm dev                 # start development server
pnpm typecheck           # TypeScript check
pnpm test                # all Vitest tests
pnpm test:integration    # HTTP tests under test/integration
pnpm test:watch          # Vitest watch mode
pnpm check               # formatting and lint check
pnpm fix                 # safe automatic formatting/lint fixes
pnpm openapi             # regenerate openapi.json
pnpm build               # compile and regenerate openapi.json
pnpm db:generate         # generate a migration after schema changes
pnpm db:migrate          # apply migrations
pnpm db:seed             # seed platform defaults
```

Local PostgreSQL and Redis run through `docker compose`. PostgreSQL is exposed on host port `5433`; Redis is exposed on `6380`.

## Code Style

- Prefer named `function` declarations for reusable/top-level functions.
- Use arrow functions for inline callbacks.
- Do not add explicit return types when TypeScript can infer them correctly.
- Do not add one-use wrappers such as `reportFatalError`, `formatConfigError`, or `healthHandler`; inline the logic when it remains readable.
- Prefer `unknown` over `any`.
- Prefer type narrowing over assertions.
- Do not use casts to work around an incorrect model. Fix the source type.
- Keep functions focused. Extract only when the extraction has a clear domain meaning or removes real duplication.
- Use descriptive constants instead of unexplained magic numbers.
- Use early returns for error cases.
- Never commit `console.log`, `debugger`, `.only`, or `.skip`.

## Imports and TypeScript

- Source imports use `@/` without file extensions.
- Test imports use `@test/` without file extensions.
- `tsx` runs development and scripts; `tsdown` builds the production bundle and resolves `@/` aliases; `tsc --noEmit` handles type checking.
- There is one root `tsconfig.json` and one build config. Do not add separate test tsconfig files.
- `oxc/no-barrel-file` is intentionally disabled globally.
- Barrel files are allowed. `src/db/schema/index.ts` must re-export every domain schema file and is the Drizzle schema registry.
- Avoid pointless re-export-only files where direct imports are clearer.

## Architecture

```text
src/
  app.ts                 # build the Fastify application
  server.ts              # process entry point and signal handling
  lib/                   # cross-domain reusable infrastructure/helpers
  db/
    index.ts             # Db type
    seed.ts              # production seed
    schema/<domain>.ts   # Drizzle tables and relations
  plugins/               # Fastify cross-cutting plugins
  routes/                # operational routes such as health checks
  modules/<domain>/      # business modules
    routes.ts
    schema.ts
    service.ts
    util.ts
```

- Business code belongs in `src/modules/<domain>`.
- `src/routes` is for operational endpoints, not business domains.
- `src/lib` is for shared concerns used by multiple modules. Do not turn it into a catch-all.
- Do not add an `infra/` directory unless a concrete architectural need appears.
- Plugin and route filenames should use one clear word where possible.
- Route modules should follow `routes.ts`, `schema.ts`, `service.ts`, and `util.ts` when those concerns exist.
- Route handlers stay thin. Database queries and business decisions belong in the service layer.
- Services accept `Db` (or an explicit shared dependency) instead of reaching into Fastify internals.
- Export `Db` from `src/db/index.ts`. Do not create `src/lib/db.ts`.

## Registration

- `registerPlugins()` in `src/plugins/index.ts` is the only plugin registration entry point.
- `registerRoutes()` in `src/routes/index.ts` is the only route registration entry point.
- Registration must be explicit. Do not add autoload.
- Register plugin order deliberately; config, database, Redis, security, sensible, auth, errors, request logging, and OpenAPI currently depend on that order.

## API Conventions

- Public business APIs use `/api/v1/*`.
- Better Auth is mounted at `/api/v1/auth/*`.
- Health endpoints are intentionally unversioned:
  - `GET /healthz`
  - `GET /readyz`
- Do not add `/api/*` aliases or a legacy compatibility layer.
- Use plural nouns and stable resource-oriented paths.
- Use `ranking`, not `leaderboard`, `wager-race`, or legacy equivalents.
- Ranking database names use `ranking_period`, `ranking_entry`, and `ranking_reward`.
- Do not expose Swagger UI or `/docs-json`.
- Generate the static OpenAPI contract with `pnpm openapi`; downstream SDKs and types are generated from `openapi.json`.

## Validators and Schemas

- Use Zod for environment validation and HTTP request/response schemas.
- Do not use TypeBox.
- Keep request/response schemas in the domain module's `schema.ts`.
- Every public operation needs a globally unique, stable `operationId`.
- Response schemas must describe the public contract. Do not leak Drizzle rows.
- Avoid duplicated schema definitions when `.pick()`, `.extend()`, or shared component schemas communicate the contract more clearly.
- Fastify uses the Zod validator and serializer compilers configured in `app.ts`.

## Authentication and Authorization

Use the auth decorators rather than duplicating session handling:

```ts
fastify.auth.optional
fastify.auth.required
fastify.auth.roles(['admin'])
fastify.auth.session(request)
```

- Public endpoints with optional identity use `fastify.auth.optional`.
- Authenticated endpoints use `fastify.auth.required`.
- Admin-only endpoints use `fastify.auth.roles(['admin'])`.
- Authenticated handlers use `fastify.auth.session(request)` to obtain the non-null `{ session, user }` context.
- Do not repeat `request.user?.id` null checks or use `request.user!` in protected handlers.
- Do not define duplicate `AuthUser` interfaces.
- Do not use `as AuthUser`; extend Better Auth inference instead.
- Better Auth owns cookies and sessions. Keep `basePath` aligned with `/api/v1/auth` and cookies available at `Path=/`.
- Auth HTTP routes are hidden from OpenAPI.

## Errors

- `@fastify/sensible` is installed; use `fastify.httpErrors.*` for HTTP errors.
- The global error plugin maps Zod validation errors and common PostgreSQL error codes. Do not repeat that mapping in routes.
- Service-layer code may attach `statusCode` to an `Error` when Fastify context is unavailable, but do not create a parallel error framework.
- Do not expose stack traces, SQL details, or unknown 5xx error messages.
- Keep 5xx response payloads generic.
- Log server errors through the request logger.

## Database

- Schema files are split by domain under `src/db/schema/`.
- `src/db/schema/index.ts` re-exports all domain schemas and is the registry for Drizzle.
- Database identifiers use `snake_case`; TypeScript properties use `camelCase`.
- Add indexes, unique constraints, checks, and foreign-key behavior deliberately.
- Migrations live in `drizzle/` and are committed. Never edit an applied migration; generate a new one.
- Production seed code lives in `src/db/seed.ts`.
- Seed data must match the established legacy seed behavior unless explicitly changed. It includes USDT/USD, the development admin, the House user, and the six built-in games.
- Seed operations must be idempotent.
- Do not put fixture or test-only data in the production seed.
- Monetary columns use integer/bigint minor units. Do not store money as floating point.
- Use transactions and explicit locking/version checks for wallet mutations.
- A separate test database is intentionally not configured yet. Do not add test database setup, fixtures, or real-database suites unless explicitly requested.

## Money and Currency

- API amounts are decimal strings, never floating-point numbers.
- Internal amounts are `bigint` minor units.
- Use `formatAmount()` with the currency's configured decimals when crossing the API boundary.
- Keep currency codes uppercase at the boundary.
- Do not hardcode `BRL`; the current platform currencies are USDT and USD.
- Be careful with rounding, precision, locks, and idempotency in wallet flows.

## Configuration and Logging

- Configuration is loaded with `dotenv` from `.env.local`, then `.env`.
- Do not switch to Node's `--env-file`.
- Validate environment variables with Zod in `src/lib/config.ts`.
- Access configuration through `fastify.config` or an explicit `AppConfig` input.
- Development logs use `pino-pretty` with one-line output.
- Fastify's duplicate request logging is disabled; request logging is handled by the request plugin.
- Do not emit startup or shutdown log noise that is already handled by the application lifecycle.
- Request IDs from `X-Request-Id` are preserved only when they match the accepted pattern; otherwise generate a UUID.
- The response includes `X-Request-Id`.

## Testing

- Use Vitest and `app.inject()` for HTTP behavior.
- Test files use `*.test.ts` under `test/`.
- Shared app setup belongs in `test/helper.ts`.
- Keep tests deterministic and close the Fastify app after each test.
- Mock external dependencies when behavior can be tested without them.
- Do not add test-only production helpers solely for a test.
- Do not add `.only` or `.skip` to committed tests.
- `pnpm test` must pass without a test database or a live PostgreSQL instance.
- `pnpm test:integration` currently covers HTTP-level tests only.
- `openapi.json` is checked against generated output; regenerate it after route or schema changes.

## OpenAPI

- `openapi.json` is generated from Zod schemas and route metadata.
- Run `pnpm openapi` after changing routes or response schemas.
- Keep component names stable and domain-oriented, such as `RankingBoard`, `WalletBalance`, and `LobbyResponse`.
- Hidden infrastructure/auth routes must stay out of the contract.
- Unreachable request `*Input` components are pruned by `src/lib/openapi.ts`.
- Do not commit generated client SDKs to this repository.

## Before Finishing Work

Run the checks relevant to the change. For normal backend changes:

```bash
pnpm fix
pnpm typecheck
pnpm test
pnpm check
```

Run `pnpm test:integration` when HTTP behavior changes and `pnpm build` when the change affects the production build or generated OpenAPI contract.

Report any commands that could not be run. Do not claim a check passed unless it was actually executed.
