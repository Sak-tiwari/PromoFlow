# ADR-0010: Light observability; self-hosted auth

Status: Proposed · Date: 2026-10-31

## Observability
- `pino` JSON logs with `request_id`, `organization_id`, `store_id`; never secrets or personal data. Retained ≥ 180 days in India for any hosted deployment (CERT-In).
- Prometheus-format `/metrics`: request rate, latency, error rate per route, queue depth, cache hit rate.
- OpenTelemetry tracing and Sentry error tracking are **built in but off by default**, enabled by environment variables, because hosted collectors cost money.
- Health: `/health/live` and `/health/ready`.

## Auth
- Self-hosted TypeScript auth library, **Better Auth** as the candidate (email + password, magic link, email verification, reset, organizations/memberships). A one-day spike at the start of M1 checks it against our needs (multi-org membership, magic link, API key issuance, session security). Fallback: a thin custom implementation with argon2 password hashing and hashed one-time tokens.
- Auth sits behind an interface so MFA, Google login and SAML can be added later.
- RBAC is our own permission table, checked on the server for every route. API keys are stored hashed, shown once, scoped, rotatable and revocable.
- SSO is out of scope; revisit when a customer asks.

## Consequences
No paid services. Fewer dashboards to look at, but enough signals to debug and to demonstrate the load test.
