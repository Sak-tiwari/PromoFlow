# ADR-0009: Local-first, zero-cost deployment

Status: Proposed · Date: 2026-10-31

## Context
Budget is 0 INR. Free cloud tiers change, need cards for verification, or sleep when idle.

## Decision
- **Primary target:** `docker compose up` (Postgres 16, a second Postgres for the dedicated-DB demo, Mailpit, API, worker, dashboard). Works on a laptop or college lab machine with no account anywhere.
- **Optional public demo:** Oracle Cloud Always Free ARM VM. Advertised as up to 4 OCPU / 24 GB, but sign-up needs a card, users report Indian cards being rejected and frequent "out of capacity" errors, and one 2026 article claims the tier was reduced (unverified). Treat as a bonus, never a dependency.
- **Fallback database for demos only:** Neon Free (reported 1 GB per project after an Oct 2026 change, 100 CU-hours, scale-to-zero). Cold starts make it unsuitable for load tests.
- **Dashboard:** static build on any free static host; check current terms at deploy time.
- **Email:** an `EmailProvider` interface. Mailpit locally; SMTP credentials via env in any real deployment.
- Load tests run locally and report the machine spec alongside results.

## Consequences
The project is demonstrable with zero external dependency. Public availability is best-effort.
