# Runbook: Gemma PIM POC

Operational guide for the POC. Behaviour that is still assumed (AW, PrestaShop 9, Temu) is listed in
[open-questions.md](open-questions.md); read it before trusting any production result.

## 1. Run locally

Prerequisites: Node from `.nvmrc`, pnpm 10.33.0, Docker.

```bash
pnpm install
cp docker/postgres.env.example docker/postgres.env     # git-ignored, edit the password
cp docker/mongo.env.example docker/mongo.env           # git-ignored
pnpm docker:up                                         # postgres, redis, mongo, minio (+ bucket), grafana stack
for app in api worker cron auth; do cp apps/$app/.env.example apps/$app/.env; done
pnpm db:generate && pnpm build
pnpm --filter @repo/database db:migrate:deploy         # or pnpm db:migrate while developing
pnpm db:seed                                           # tenant "gemma" + supplier "aw-aiku" (STAGING, no credentials)
pnpm dev
```

| Service | Port                      | Notes                                                    |
| ------- | ------------------------- | -------------------------------------------------------- |
| auth    | 3000                      | Better Auth, sign-in for the back office                 |
| api     | 3100                      | REST under `/api`, Swagger at `/api/docs`                |
| cron    | 3200                      | only enqueues jobs (see section 4)                       |
| worker  | 3400                      | BullMQ consumers: all sync and saga logic runs here      |
| web     | Angular dev server        | proxy config in `apps/web/proxy.conf.json`               |
| MinIO   | 9000 (S3), 9001 (console) | bucket `pim-media`, created by the `minio-init` one-shot |

MinIO images are pulled from `quay.io/minio/*` (Docker Hub no longer has them); override with `PIM_MINIO_IMAGE` and
`PIM_MINIO_MC_IMAGE` if you mirror them. The compose defaults for MinIO credentials are MinIO's development defaults;
`PIM_S3_ACCESS_KEY` / `PIM_S3_SECRET_KEY` in the apps' `.env` must equal them.

Node must be the `.nvmrc` version for `apps/web` (`nvm use`).

### Environment variables

Declared with empty values in the root `.env.example`; the api and worker apps read them through `ConfigService`
(lazily, only when first needed). Supplier and channel credentials are **not** environment variables: they are entered
in the back office (Settings) and stored AES-256-GCM encrypted in the database.

| Variable                                                                                                                                                                                                              | Purpose                                                      | Notes                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `PIM_ENCRYPTION_KEY`                                                                                                                                                                                                  | AES-256-GCM key for credentials and order PII                | base64 of 32 bytes: `openssl rand -base64 32`. Lose it and every stored credential and order address is unreadable |
| `PIM_TENANT_SLUG`                                                                                                                                                                                                     | Tenant the back office acts on                               | optional, default: oldest tenant (seed creates `gemma`)                                                            |
| `PIM_S3_ENDPOINT`, `PIM_S3_REGION`, `PIM_S3_BUCKET`, `PIM_S3_ACCESS_KEY`, `PIM_S3_SECRET_KEY`                                                                                                                         | Image storage (MinIO locally)                                | path-style; region defaults to `us-east-1`                                                                         |
| `PIM_S3_PUBLIC_BASE_URL`                                                                                                                                                                                              | Public base URL channels download images from                | default `<endpoint>/<bucket>`; must be reachable by PrestaShop and Temu                                            |
| `ANTHROPIC_API_KEY`, `PIM_LLM_MODEL`, `PIM_LLM_BASE_URL`, `PIM_LLM_MAX_TOKENS`                                                                                                                                        | PT-PT enrichment                                             | not needed unless "Generate" is used                                                                               |
| `PIM_ORDER_DEFAULT_EMAIL`, `PIM_ORDER_DEFAULT_PHONE`                                                                                                                                                                  | Used when a channel hides the customer email or phone (Temu) | required for order routing, never leave empty                                                                      |
| `PIM_ORDER_MIN_MARGIN`, `PIM_ORDER_VAT_RATE`, `PIM_ORDER_SHIPPING_ABSORBED`                                                                                                                                           | Cap on the AW order cost (fractions: 0.15 = 15%)             | defaults 0.15 and 0.23                                                                                             |
| `CRON_TIMEZONE`, `CRON_AW_CATALOG_FULL`, `CRON_AW_STOCK_SYNC`, `CRON_PS_ORDER_IMPORT`, `CRON_TEMU_ORDER_IMPORT`, `CRON_SUPPLIER_ORDER_STATUS_POLL`, `CRON_LISTING_REVIEW_POLL`, `CRON_SHIP_BY_SCAN`, `CRON_PII_PURGE` | Cron overrides (cron app)                                    | default timezone `Europe/Lisbon`                                                                                   |

### First-time setup in the back office (Settings)

1. Supplier `aw-aiku`: paste the AW token, pick `staging` first (NFR-05: staging before production; staging resets
   every Sunday 03:00 UTC, so ids do not survive), press "Test". A 401 shows `invalid_credentials`.
2. Channels: PrestaShop 9 (`baseUrl`, Admin API client id/secret and/or Webservice key, `paidStateIds`,
   `shippedStateId`) and Temu EU (`gatewayHost`, app key, app secret, access token, carrier table).
3. Category mapping: map each supplier department/sub/family to an internal category and channel category ids.
4. Price rules, or accept the default rule (markup 50%, min margin 10%, VAT 23%, rounding x.99).

## 2. Tests and quality gates

```bash
pnpm lint && pnpm check-types
pnpm test:cov                                     # unit tests + per-package coverage thresholds (the gate)
pnpm --filter @repo/pim-runtime test:integration  # Testcontainers Postgres, real migrations, HTTP faked
```

Integration tests need Docker. Without it they **skip** with a message
(`[pim-runtime integration] SKIPPED: Docker is not available`); set `PIM_IT_REQUIRE_DOCKER=1` to make that a failure
(CI does). CI: `.github/workflows/ci.yml` (quality job, then integration job).

## 3. Run each sync manually

API calls need an authenticated back office session (Better Auth cookie); the screens call the same endpoints.

| What                             | How                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full catalogue sync (FR-ING-001) | Dashboard "sync now", or `POST /api/sync/catalog` with `{ "supplierId": "<id>" }` (optional). 202 when queued, 409 while one runs (a RUNNING run older than 2 h is treated as dead). Watch `GET /api/sync-runs`                |
| Stock and cost sync (FR-ING-002) | `POST /api/sync/stock-cost` (same body)                                                                                                                                                                                        |
| Publish / unpublish a product    | Product detail, Channels tab, or `POST /api/products/:id/channels/:channelId/publish` and `/unpublish`. Needs approved enrichment, mapped category, images and a non-blocked price (`GET .../readiness` lists what is missing) |
| Import channel orders            | Scheduled every 10 min. No API trigger: enqueue `job:import_channel_orders` with `{ tenantId, channelId }` on `order-import-queue`                                                                                             |
| Route an order to AW             | Orders, "Retry", or `POST /api/orders/:id/retry`                                                                                                                                                                               |
| Poll supplier order status       | Scheduled every 15 min; manual: job `job:poll_supplier_order_status` with `{ tenantId }` on `order-status-queue`                                                                                                               |
| Poll Temu listing reviews        | Scheduled every 30 min; job `job:poll_listing_review` `{ tenantId, channelId }` on `listing-sync-queue`                                                                                                                        |

Schedules (Europe/Lisbon): catalogue 03:30 daily, stock every 30 min, PS and Temu order import every 10 min, supplier
status every 15 min, Temu review poll every 30 min, ship-by scan hourly, PII purge 04:00 daily. The cron app must run as
a single instance.

Queue jobs can be added with any BullMQ client against Redis. A stable `jobId` is used; a failed job with the same
id is removed first, a waiting or active one is kept (so double clicks collapse).

## 4. Failed and stuck orders

Order state machine: `imported -> routing -> supplier_submitted -> supplier_dispatched -> tracking_pushed -> completed`,
with side states `manual_review`, `supplier_failed`, `tracking_missing`, `cancelled`. Every order is idempotent on
(channel, external order id), and there is at most one supplier order per channel order, so **retrying never creates a
second AW order**: the saga resumes from the last persisted step (client, order, each line, note, validation, submit).

| Symptom                                                                   | Meaning                                                                                                                        | Action                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manual_review`, alert `routing_manual_review`                            | A line SKU is unknown to the PIM, has no active assortment item, suppliers are mixed, or the cost cap could not be computed    | Fix the data (add the product to Gemma, re-activate the assortment item), then "Retry"                                                                                                                                                                                        |
| `supplier_failed`                                                         | A saga step failed after retries (network, 4xx/5xx from AW). The AW order, if created, is **kept**                             | Read `last_error` on the order, fix the cause (token, balance, address), "Retry". It resumes where it stopped                                                                                                                                                                 |
| Order stays `routing` with a `creating` supplier order and no running job | The worker died mid-saga                                                                                                       | "Retry": progress is stored, it resumes without duplicating                                                                                                                                                                                                                   |
| Alert `cost_exceeds_max`                                                  | AW total is not below `maxSupplierCost` (order total minus minimum margin). The AW order is left as a draft, **not submitted** | Decide: lower supplier cost or accept the loss. To proceed, either accept a thinner margin (lower `PIM_ORDER_MIN_MARGIN`, which raises the cap) or fix the price, then "Retry" (validation re-runs). To abandon, delete the draft in the AW portal and follow the reset below |
| Alert `quantity_mismatch`                                                 | AW `item_quantity` differs from the ordered sum                                                                                | Inspect the AW draft in the portal, correct or delete it                                                                                                                                                                                                                      |
| Alert `supplier_quantity_fail` / `supplier_cancelled`                     | AW failed or cancelled a line                                                                                                  | Contact the customer or AW; there is no automatic refund or cancel                                                                                                                                                                                                            |
| `tracking_missing`                                                        | Supplier dispatched with no tracking, or a push failed                                                                         | Section 5                                                                                                                                                                                                                                                                     |

Resetting a supplier order **only** after the AW draft was deleted by hand in the AW portal (otherwise a retry would
keep using the dead order id). Run against the PIM database, with the channel order id:

```sql
UPDATE supplier_order
   SET "sagaProgress" = '{}', "externalOrderId" = NULL, "externalClientId" = NULL,
       state = 'CREATING', "lastError" = NULL
 WHERE "channelOrderId" = '<channel order id>';
```

Then press "Retry". Do not touch `supplier_order` while a job for that order is running.

A channel cancellation is **not** detected automatically in this POC (the cancel service exists but nothing calls it):
check cancelled orders in PrestaShop or Temu by hand and, if the AW order is still a draft, delete it in AW.

## 5. Manual tracking (until S0.1 is solved)

AW exposes no tracking in the documented API, so the operator does it:

1. Open the AW portal, find the order by `public_notes` (`<CHANNEL>-<channel order id>`, for example `PS9-1001`) and
   copy carrier and tracking number once dispatched.
2. Back office, Orders, open the order (state `supplier_submitted`), fill carrier and tracking, save. This creates a
   `shipment` with source `manual` and pushes it to the originating channel immediately.
3. PrestaShop: sets the tracking number on the order carrier and moves the order to the "Shipped" state.
   Temu: the carrier **must** exist in the channel's carrier table (Settings), otherwise the push is blocked with
   `UNKNOWN_CARRIER`; add the mapping and save again. Never guess a carrier.
4. Saving the same carrier and tracking again is a no-op; a failed push is retried by saving again, and is recorded in
   `shipment.push_error` with an alert `tracking_push_failed`.

Temu deadline: alert `ship_by_deadline` fires 12 h before the ship-by time when an order has no tracking (hourly scan).
Post tracking within 24 h of dispatch. Do not scale Temu volume until S0.1 is solved (PRD risk table).

## 6. Rotate credentials

Credentials are write-only in the UI and API (never returned; responses only say `credentialsConfigured`).

- **AW token, PrestaShop keys, Temu app secret or token:** Settings, open the supplier or channel, paste the new
  value, save, press "Test". Connectors are cached per stored credentials and rebuilt on the next call. Revoke the old
  credential at the provider after the test passes. Saving writes an audit event (`credentials.updated`) without the
  value.
- **`PIM_ENCRYPTION_KEY`:** there is no rotation tool. Changing the key makes every stored credential and every stored
  order address unreadable. Procedure if you must: keep the old key, deploy the new one only after re-entering all
  supplier and channel credentials in Settings; orders imported under the old key cannot be routed or shown afterwards,
  so rotate only when no order is open (all `tracking_pushed` or later).
- **Database, Redis, S3 credentials:** change in `.env` of api, worker and cron together and restart; update
  `docker/postgres.env` and MinIO variables for local compose.
- Never put a secret in the repo, `.env.example`, logs or an issue. If one leaked, rotate it immediately.

## 7. Temu token expired or revoked

Symptom: channel status shows `reauthorization_required` (Settings, "Test" on the channel), Temu order import and
stock pushes fail, dashboard shows errors. Temu error codes 3000002 (expired) and 3000003 (revoked) and HTTP 401/403
map to it (codes are assumptions, see S0.8).

1. Re-authorize the app in the Temu seller account (Partner Platform) and obtain a new seller access token.
2. Settings, Temu channel, paste the new access token (app key and secret unchanged unless they were rotated), save,
   "Test" must return ok.
3. The next scheduled import picks orders up again; the order poll cursor only advances past successfully stored
   orders, so nothing is skipped. Check the ship-by deadlines of orders missed meanwhile and post their tracking first.
4. If stock pushes failed meanwhile, run a stock and cost sync so listings converge (oversell risk while it was down).

## 8. Reading logs and health

- Health: `GET /api/health/live` and `/api/health/ready` on each app.
- Every outbound call is in `integration_request_log` (method, URL without secrets, status, duration, correlation id);
  secrets are redacted. There is **no automatic 30 day purge yet**: delete old rows by hand if the table grows
  (`DELETE FROM integration_request_log WHERE "createdAt" < now() - interval '30 days';`).
- `sync_run` is the audit of each sync (counters, status `SUCCEEDED` / `PARTIAL` / `FAILED`, error summary). A `PARTIAL`
  run records the failed page; the next run reprocesses everything idempotently.
- Dashboard: last run per job, alerts (margin blocked, missing products, Temu deadlines, failed orders).
- Grafana at `localhost:3333` (Prometheus, Loki) from docker compose.
