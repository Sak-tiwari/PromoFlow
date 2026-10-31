# ADR-0003: Shared database with RLS, plus a tenant router for dedicated databases

Status: Proposed · Date: 2026-10-31

## Context
You asked to "try for a dedicated database". A database per tenant for every merchant costs real money and operational
work, which conflicts with the 0 INR budget and with the 10,000-merchant scale target.

## Decision
- Default: one Postgres, all tenants, **row-level security** keyed on `organization_id` via `SET LOCAL app.org_id`.
- A **tenant router** (`resolveDb(orgId)`) returns the right connection pool. A tenant row may carry `db_route` to a dedicated database. The same migration runner applies migrations to every routed database.
- The demo runs the shared DB plus **one tenant on a second Postgres container** to prove the path.
- App DB role has no `BYPASSRLS`; the data layer refuses queries with no tenant context.

## Consequences
- Cheap by default, with a real isolation upgrade for large or regulated tenants.
- Cross-tenant reports (platform admin) must go through the router, not one SQL query.
- Migrations take longer as dedicated databases are added; the runner handles them in a loop.

## Tests
CI cross-tenant tests attempt reads and writes across tenants on every public service, in both shared and dedicated mode.
