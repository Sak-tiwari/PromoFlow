# ADR-0001: TypeScript end to end

Status: Proposed · Date: 2026-10-31

## Context
Two people, 0 INR, a JS/TS background, and a hot path that is mostly I/O (database reads, one transaction per redemption).
The brief asked for one recommendation and one alternative.

## Decision
- **Runtime/language:** TypeScript on Node 22 LTS. One language for API, engine, SDK and UI, and the same engine package can run in the dashboard simulator.
- **API framework:** Fastify with Zod schemas (OpenAPI generated from them via `@fastify/swagger`). Light, fast, schema-first. NestJS was rejected as heavier than needed.
- **Dashboard:** React + Vite SPA, TanStack Query/Router, shadcn/ui (Radix + Tailwind). Accessible components we own in the repo. No SSR needed.
- **DB access:** Kysely (typed SQL builder) with reversible migrations. Atomic conditional updates and RLS are plain SQL, which an ORM would hide.
- **Queue:** `pg-boss` (see ADR-0002).
- **Monorepo:** pnpm workspaces (no extra build orchestrator yet).
- **Testing:** Vitest, fast-check, Testcontainers, Playwright, k6.
- **Alternative considered:** Go API + TypeScript dashboard. Cheaper per request at 10,000 merchants, but it splits the team across two languages, needs a second implementation of the rules engine (or WASM), and breaks end-to-end types. Not worth it for this project. The pure engine package keeps the door open to port later.

## Versions
Current on npm on 31 Oct 2026: Fastify 5.12, Kysely 0.29, pg-boss 12.38, Zod 4.6, pino 10.4, Vitest 5.0, Vite 8.3, i18next 26.5, react-i18next 17.1, fast-check 4.10, Testcontainers 12.2, Better Auth 1.7. Several are recent majors, so versions are pinned by lockfile and re-checked at M1 start.

## Consequences
Single toolchain. Node is slightly less efficient than Go per request, which is irrelevant at this budget and fixable by adding instances.
