# ADR-0002: PostgreSQL is the only datastore (no Redis at launch)

Status: Proposed · Date: 2026-10-31 · **Deliberate simplification**, recorded as technical debt per the brief.

## Context
The brief suggests Redis for cache, rate limits, hot counters and the queue. Each extra service is another thing to run,
secure and pay for at 0 INR.

## Decision
Use Postgres for everything:
- source of truth, counters and budget ledger (atomic conditional updates);
- queue and scheduling via `pg-boss`;
- cache invalidation via `LISTEN/NOTIFY`, with an in-process LRU for compiled rule sets;
- idempotency records and the outbox;
- rate limiting: in-memory per instance at launch (`@fastify/rate-limit`) with a Postgres-backed store available if per-store limits must be exact across instances.

## Consequences
- One thing to run and back up; transactional guarantees across all of the above.
- Rate limits are approximate across instances until a shared store is added.
- Hot counters serialize on a row: mitigated by sharded counters (ARCHITECTURE §6), measured in M4.

## Revisit when
The M4 load test misses the p95/p99 targets because of counter contention or cache lag, or when the number of API instances makes per-instance rate limiting too loose. Redis then slots in behind the existing cache and rate-limit interfaces.
