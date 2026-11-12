# VRF Game Service

Fastify API service for VRF Game, built as the incremental replacement for the legacy NestJS API.

## Tech Stack

- Node.js 24, TypeScript, ESM, pnpm
- Fastify 5
- PostgreSQL 17 with Drizzle ORM
- Redis 7
- Better Auth
- Zod
- Vitest
- Ultracite with Oxlint and Oxfmt

## Requirements

- Node.js 24+
- pnpm
- Docker Compose

## Quick Start

```bash
pnpm install
cp .env.example .env.local
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API runs at `http://localhost:8000`. PostgreSQL is exposed on port `5433` and Redis on `6380`.

Health checks:

```text
GET /healthz
GET /readyz
```

## Commands

| Command                 | Description                           |
| ----------------------- | ------------------------------------- |
| `pnpm dev`              | Start development server              |
| `pnpm build`            | Compile and regenerate `openapi.json` |
| `pnpm start`            | Start the compiled server             |
| `pnpm test`             | Run all tests                         |
| `pnpm test:integration` | Run HTTP integration tests            |
| `pnpm typecheck`        | Run TypeScript checks                 |
| `pnpm check`            | Check formatting and lint rules       |
| `pnpm fix`              | Apply safe automatic fixes            |
| `pnpm openapi`          | Regenerate `openapi.json`             |
| `pnpm db:generate`      | Generate a migration                  |
| `pnpm db:migrate`       | Apply migrations                      |
| `pnpm db:seed`          | Seed platform defaults                |
| `pnpm db:studio`        | Open Drizzle Studio                   |

## OpenAPI

The service does not expose Swagger UI. Generate the static contract with:

```bash
pnpm openapi
```

`openapi.json` is used to generate frontend SDKs and TypeScript types.

## Configuration

Environment variables are loaded from `.env.local`, then `.env`, and validated with Zod. See `.env.example` for the available settings.

Tests and development currently do not require a separate test database.

## Development

Engineering rules are documented in [AGENTS.md](./AGENTS.md). Formatting and linting use [Ultracite](https://www.ultracite.ai/).
