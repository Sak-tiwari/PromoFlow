# Data model (draft)

Refined from the starting list in the brief. All tenant-owned tables carry `organization_id` and have row-level
security. Money columns are `bigint` paise. Timestamps are `timestamptz` (UTC).

```mermaid
erDiagram
  ORGANIZATION ||--o{ STORE : owns
  ORGANIZATION ||--o{ MEMBERSHIP : has
  USER ||--o{ MEMBERSHIP : joins
  ORGANIZATION ||--o{ INVITATION : sends
  STORE ||--o{ API_KEY : issues
  STORE ||--o{ PROMOTION : contains
  PROMOTION ||--|{ PROMOTION_VERSION : versions
  PROMOTION ||--o{ CODE_BATCH : generates
  PROMOTION ||--o{ CODE : triggers
  CODE_BATCH ||--o{ CODE : yields
  STORE ||--o{ CUSTOMER : knows
  CUSTOMER ||--o{ REDEMPTION : makes
  STORE ||--o{ REDEMPTION : records
  PROMOTION_VERSION ||--o{ REDEMPTION_LINE : priced_by
  REDEMPTION ||--|{ REDEMPTION_LINE : allocates
  PROMOTION ||--o{ USAGE_COUNTER : limits
  PROMOTION ||--o{ BUDGET_LEDGER : spends
  REDEMPTION ||--o{ BUDGET_LEDGER : posts
  STORE ||--o{ WEBHOOK_ENDPOINT : notifies
  WEBHOOK_ENDPOINT ||--o{ WEBHOOK_DELIVERY : attempts
  ORGANIZATION ||--o{ AUDIT_LOG : records
  USER ||--o{ NOTIFICATION : receives

  ORGANIZATION {
    uuid id PK
    text name
    text status
    text db_route "null means shared database"
  }
  STORE {
    uuid id PK
    uuid organization_id FK
    text name
    text currency "INR"
    text timezone "IANA"
    text gst_state_code
    jsonb settings "stacking policy, email normalization"
    bigint rules_version
  }
  USER {
    uuid id PK
    text email UK
    text locale
    timestamptz email_verified_at
  }
  MEMBERSHIP {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    text role
  }
  INVITATION {
    uuid id PK
    uuid organization_id FK
    text email
    text role
    text token_hash
    timestamptz expires_at
  }
  API_KEY {
    uuid id PK
    uuid store_id FK
    text kind "secret or publishable"
    text mode "live or test"
    text prefix
    text key_hash
    jsonb scopes
    timestamptz last_used_at
    timestamptz revoked_at
  }
  PROMOTION {
    uuid id PK
    uuid store_id FK
    text slot "coupon or payment"
    text kind "code or automatic or payment_offer"
    text status
    uuid current_version_id FK
  }
  PROMOTION_VERSION {
    uuid id PK
    uuid promotion_id FK
    int version_no
    jsonb benefit
    jsonb conditions "AND OR NOT tree"
    jsonb limits
    text funded_by "merchant or third_party"
    text tax_treatment
    jsonb labels "per locale"
    int priority
    timestamptz starts_at
    timestamptz ends_at
    jsonb recurring_windows
  }
  CODE_BATCH {
    uuid id PK
    uuid promotion_id FK
    int requested_count
    int generated_count
    text status
    jsonb config
  }
  CODE {
    uuid id PK
    uuid store_id FK
    uuid promotion_id FK
    uuid batch_id FK
    text code_normalized UK "unique per store"
    text kind "shared or unique or personal"
    boolean discoverable
    text status
    uuid customer_id FK
  }
  CUSTOMER {
    uuid id PK
    uuid store_id FK
    text external_id UK "unique per store"
    text email_hmac
    int order_count
    timestamptz first_order_at
    timestamptz erased_at
  }
  REDEMPTION {
    uuid id PK
    uuid store_id FK
    uuid customer_id FK
    text order_id UK "unique per store and mode"
    text status
    text mode "live or test"
    jsonb result_snapshot
    bigint payable
    timestamptz created_at "partition key"
  }
  REDEMPTION_LINE {
    uuid id PK
    uuid redemption_id FK
    uuid promotion_version_id FK
    text line_id
    bigint discount_amount
    bigint taxable_value
    bigint cgst
    bigint sgst
    bigint igst
    bigint reversed_amount
  }
  USAGE_COUNTER {
    uuid id PK
    uuid promotion_id FK
    uuid code_id FK
    uuid customer_id FK
    text period_key
    int shard
    int used
    int cap
  }
  BUDGET_LEDGER {
    uuid id PK
    uuid promotion_id FK
    uuid redemption_id FK
    bigint delta
    bigint balance_after
  }
  WEBHOOK_ENDPOINT {
    uuid id PK
    uuid store_id FK
    text url
    text secret_hash
    text status
  }
  WEBHOOK_DELIVERY {
    uuid id PK
    uuid endpoint_id FK
    text event_type
    int attempt
    text outcome
  }
  AUDIT_LOG {
    uuid id PK
    uuid organization_id FK
    uuid actor_id
    text action
    jsonb before
    jsonb after
    timestamptz created_at "partition key"
  }
  NOTIFICATION {
    uuid id PK
    uuid user_id FK
    text type
    timestamptz read_at
  }
```

Tables without drawn relationships (to keep the diagram readable): `events` (immutable, monthly partitions),
`outbox` (written in the business transaction, relayed by the worker), `idempotency_records`
(`store_id`, `key` unique, request hash, stored response, expiry), `notification_preferences`.

## Changes from the brief's starting list

| Change | Reason |
|---|---|
| `StackingGroup` replaced by `PROMOTION.slot` | You fixed the policy at one coupon plus one payment offer; a slot is simpler than groups |
| `Segment` deferred | The merchant does not send tags; customer facts come from the `CUSTOMER` ledger fields |
| `Job` dropped | `pg-boss` owns its own tables |
| `Plan`, `Subscription`, `UsageRecord` deferred | Billing is later; an entitlement interface exists in code |
| `FeatureFlag` deferred | Admin is CLI-only for now |
| Added `payment` conditions inside `PROMOTION_VERSION.conditions` | Payment offers match on method, issuer, network and card type only. Never card numbers or BINs (see compliance-india.md) |
| Added per-line tax columns in `REDEMPTION_LINE` | Needed for GST breakup and credit-note data |
| Users and sessions | Managed by the auth library's own tables; the `USER` entity above is the logical view |

## Key constraints and indexes (summary)

- `code(store_id, code_normalized)` unique. Codes are upper-cased and trimmed.
- `customer(store_id, external_id)` unique.
- `redemption(store_id, mode, order_id)` unique, so one order cannot redeem twice.
- `idempotency_records(store_id, key)` unique.
- `usage_counter` unique on `(promotion_id, code_id, customer_id, period_key, shard)`, with a `CHECK (used <= cap)` as a last line of defence.
- `promotion_version(promotion_id, version_no)` unique; rows are never updated (enforced by a trigger).
- `audit_log`, `budget_ledger`, `events`: append-only (update/delete blocked by trigger).
- Hot-path lookup indexes: `code` by `(store_id, code_normalized)`, active promotions by `(store_id, status, starts_at, ends_at)`.
