# POC report: Gemma PIM (AW Dropship -> PIM -> PrestaShop 9 + Temu EU)

Fill the tables below with **measured** numbers from real runs. Nothing in this file has been measured yet: a blank
cell means "not measured", never "passed". Keep the raw evidence (sync_run ids, order ids, screenshots, Temu
approvals) in the evidence column.

| Field                              | Value |
| ---------------------------------- | ----- |
| Period                             |       |
| Environment (staging / production) |       |
| Commit / version                   |       |
| Author                             |       |

## 1. Success criteria (PRD 2.3)

| ID  | Criterion                                             | Target                                                                         | Measured | Met? (yes/no) | Evidence | Notes |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------------- | -------- | ----- |
| SC1 | Full AW catalogue ingestion                           | <= 30 min, 0 unhandled errors, re-run with no changes writes 0 product updates |          |               |          |       |
| SC2 | Stock propagation latency (AW to PrestaShop and Temu) | <= 60 min                                                                      |          |               |          |       |
| SC3 | Products live on PrestaShop via PIM                   | >= 50 real products                                                            |          |               |          |       |
| SC4 | Products live on Temu via PIM                         | >= 20 real products approved by Temu                                           |          |               |          |       |
| SC5 | Orders routed to AW without manual steps              | >= 5 real orders (PrestaShop) and >= 1 (Temu), 0 duplicates                    |          |               |          |       |
| SC6 | Tracking uploaded to Temu within Temu's deadline      | 100% of POC Temu orders                                                        |          |               |          |       |
| SC7 | No sale below minimum margin                          | 0 occurrences                                                                  |          |               |          |       |

## 2. Spike outcomes

| ID            | Answer                                     | Date | Code changed | Fixtures recorded |
| ------------- | ------------------------------------------ | ---- | ------------ | ----------------- |
| S0.1 to S0.11 | see [open-questions.md](open-questions.md) |      |              |                   |

## 3. What migrates to TXPIM

Assessment written from the code as it stands, before any real run. Revise it with what the POC actually showed.

### Migrates as is (or with import path changes only)

- `packages/core-domain`: pricing with margin guard, stock rules, content hashing, order state machine, enrichment
  validator, AES-GCM helpers. Pure functions, decimal-safe, no framework or tenant coupling.
- `packages/connector-contracts`: `ISourceConnector`, `IChannelConnector`, `ConnectorCapabilities`, DTOs. Written to
  match TXPIM, with a few optional fields added (payload hash, `skipped`, `manualReview`, `error`) that TXPIM should
  adopt.
- `packages/http-client`: retry with backoff and jitter, `Retry-After`, token bucket, secret redaction, request log
  sink, fake fetch for tests.
- `packages/connector-aw-aiku` (after S0.1 to S0.7 close): stateless adapter, resumable six-step saga that never
  creates a second supplier order.
- `packages/pim-catalog` ingestion and change detection (`CatalogIngestionService`, content hash excluding stock and
  price, missing handling) and curation (`CurationService`).
- `packages/pim-orders` order import idempotency, saga persistence and resume, shipment push and manual tracking,
  listing sync with changed-only batches (logic is sound, the persistence shape is not, see below).
- Test approach: fixtures plus fake fetch at the HTTP boundary, Testcontainers integration scenarios
  (`packages/pim-runtime/test-integration`).

### Needs redesign

- **Tenancy and Scope:** `TenantContext` resolves one tenant (env slug or oldest); `channel.scope_id` is stored and
  never used. Needs real user-to-tenant resolution and the TXPIM `Scope` concept end to end.
- **Supplier binding:** `SupplierScope` (async-local storage) binds the single `ISourceConnector` to a supplier per
  call. A hidden ambient context; TXPIM should pass the supplier explicitly or resolve a connector per supplier.
- **Credentials and keys:** one env key (`PIM_ENCRYPTION_KEY`) encrypts all secrets and PII, no rotation, no per-tenant
  key. Needs KMS or per-tenant keys, rotation and a proper secret store.
- **Order data model:** ship-by, delivered, purge and alert-dedupe markers live inside the `lines` JSON envelope
  (`order-lines.codec.ts`); `lastPayloadHash` packs hash and image checksums into one string
  (`listing-state.codec.ts`). Both are schema gaps to promote to real columns.
- **Alerts:** stored as audit events (`AuditAlertAdapter`), no alert entity, no acknowledge workflow beyond that, no
  delivery (email, chat).
- **Temu:** placeholder signing, methods and compliance fields until S0.8 and S0.9; pending price changes kept in
  memory (`PendingPriceTracker`), lost on restart; delivery date source for PII retention is missing.
- **Shipping cost model:** one flat `shippingAbsorbed` setting instead of a country and weight table (S0.7).
- **Order cancellation:** service exists but nothing detects channel cancellations or calls it.
- **Retention and compliance jobs:** no purge job for `integration_request_log`; PII purge depends on a delivered
  date nothing sets.
- **Scheduling and ops surface:** schedules are env overrides of hardcoded defaults; no UI for schedules, no API
  trigger for order import or Temu review polling.
- **AI enrichment and storage:** a thin Anthropic adapter and a hand-rolled SigV4 S3 client. TXPIM has its own AI
  credit accounting and DAM; replace rather than port.
- **Back office (`apps/web`):** minimal screens by design; expect to be rebuilt on TXPIM's UI foundations. No RBAC.
- **PrestaShop transport:** Admin API plus legacy Webservice fallback is an assumption (S0.10); the routing table may
  shrink or grow once real coverage is known.

## 4. Findings and recommendation

| Topic                                     | Finding |
| ----------------------------------------- | ------- |
| What worked                               |         |
| What did not                              |         |
| Surprises versus the PRD                  |         |
| Cost (AW, Temu fees, LLM tokens)          |         |
| Recommendation (continue / adjust / stop) |         |
