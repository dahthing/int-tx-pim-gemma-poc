# PRD: Gemma PIM POC (AW Dropship → PIM → PrestaShop 9 + Temu EU)

| Field | Value |
|---|---|
| Product | Gemma PIM POC (proving ground for TXPIM supplier ingestion and channel connectors) |
| Owner | Rui Guedes (TargX) |
| Tenant | Gemma Mystical Store (gemmams.pt) |
| Repo | Isolated POC repository (NestJS + Angular 22), mirroring TXPIM interfaces so modules can be migrated later |
| Methodology | **Spec Driven Development, tests first** |
| Status | Draft v1, 2026-09-30 |
| Companion doc | `fornecedores/aw-dropship-api.md` (full AW/Aiku API reference) |

## Decisões de adaptação ao monorepo (aceites a 2026-09-30)

Estas decisões prevalecem sobre o texto original do PRD sempre que houver conflito.

| # | Original | Decisão |
|---|---|---|
| D1 | Vitest no backend e frontend | **Jest em tudo**, tal como o padrão do repositório. Onde o PRD diz Vitest, ler Jest |
| D2 | `apps/` + `libs/` (`core-domain`, `connectors/*`, `http`) | **`packages/`** com prefixo `@repo/`: `core-domain`, `connector-contracts`, `connector-aw-aiku`, `connector-prestashop9`, `connector-temu-eu`, `http-client` (fixtures em `testing-utils`) |
| D3 | `apps/backoffice` novo | O backoffice é a **`apps/web`** existente (Angular 22) |
| D4 | argon2 ou Better Auth | **Better Auth** (já existente). Nunca Passport/JWT |
| D5 | Padrões do repo | Seguir `CLAUDE.md`: Conventional Commits, Zod v4, BullMQ, Prisma 7, `SharedModule.register()`, constantes em `@repo/shared` |

Nota: onde o PRD fala de `apps/api`, a orquestração de jobs e conectores deve seguir a divisão existente (`api`, `worker`, `cron`), sem criar apps novas sem necessidade.

---

## 0. Rules of engagement for the implementing agent (read first)

This project follows **Spec Driven Development**. The order of work is non-negotiable:

1. **Spec**: every feature below has an ID (`FR-xxx`) and acceptance criteria. Do not implement anything that is not in this PRD. If something is missing or ambiguous, add it to `docs/open-questions.md` and stop that task.
2. **Tests first**: before writing any production code for a feature, write the **unit tests** that cover **every** acceptance criterion of that feature. Commit them failing (red). Only then implement (green), then refactor.
3. **No feature is done** until: all its unit tests pass, coverage of the touched module is ≥ 90% lines / ≥ 85% branches, and the relevant contract tests (section 12.3) pass against recorded fixtures.
4. **Unit tests never hit the network.** External APIs (AW/Aiku, PrestaShop, Temu) are mocked at the HTTP client boundary using fixtures stored in `test/fixtures/<system>/`. The AW fixtures must be built from the real response examples in the companion doc.
5. **Pure logic lives in pure functions** (mappers, pricing, stock rules, state machines, hashing) so it can be tested without Nest DI or a database.
6. **Secrets**: never inline, never in the frontend bundle, `.env` always git-ignored, `.env.example` with empty values committed. Tokens stored encrypted at rest (AES-256-GCM, key from env).
7. Test tooling: **Jest** for backend and frontend unit tests (decision D1); **Testcontainers (PostgreSQL + Redis)** for integration tests; **nock/msw** for HTTP mocking.

The test catalogue in section 12 is part of the spec. Implement those tests literally before the corresponding code.

---

## 1. Context

Gemma Mystical Store is a dropshipping e-commerce store (crystals, incense, aromatherapy, spiritual products) running on PrestaShop 9. Its main supplier is **AW Dropship**, whose platform (**Aiku**, `api.aiku.io`) exposes a REST API for catalogue, portfolio ("my products"), clients, orders and order lines ("transactions").

Today product data is handled manually. The goal of this POC is to prove, end to end and on real data, that one system can:

* ingest the supplier catalogue automatically,
* hold a curated, enriched **golden record** per product,
* publish and keep in sync that product on **PrestaShop 9** and **Temu (EU, Local Seller)**,
* route orders from both channels back to the supplier and return tracking to the channel.

Strategically the POC is also the first real test of **TXPIM**'s differentiator: supplier data onboarding plus capability based connectors (`ISourceConnector`, `IChannelConnector`), multi tenant from day one, with the generic `Scope` concept. The POC is an isolated repo, but its domain model and interfaces must match TXPIM so the code can be lifted into it.

---

## 2. Goals, non goals and success criteria

### 2.1 Goals
* G1. Automatic ingestion of the AW catalogue (≈7 200 products) with change detection.
* G2. Curation: pick products into the Gemma assortment, which adds them to the AW portfolio.
* G3. Enrichment: PT-PT title/description (AI assisted with human approval), category mapping, images in own storage.
* G4. Rule based pricing per channel with margin guard.
* G5. Publish and update products on PrestaShop 9 and Temu EU.
* G6. Stock and cost sync supplier → PIM → channels on a schedule.
* G7. Order routing: PrestaShop and Temu orders become AW orders (client → order → lines → submit).
* G8. Tracking back to the channels (automatic if AW exposes it, manual fallback in the POC).

### 2.2 Non goals (POC)
* Multiple suppliers (design for it, implement only AW).
* Price intelligence / competitor prices.
* Multi language beyond PT-PT (Temu EU listing language handled per Temu requirements, see open questions).
* Returns and refunds automation.
* SaaS billing, plans, AI credit accounting (TXPIM features, not POC).
* Full DAM (only store, order and serve images).

### 2.3 Success criteria (measurable)
| ID | Criterion | Target |
|---|---|---|
| SC1 | Full AW catalogue ingestion | ≤ 30 min, 0 unhandled errors, re-run with no changes writes 0 product updates |
| SC2 | Stock propagation latency (AW → PrestaShop and Temu) | ≤ 60 min |
| SC3 | Products live on PrestaShop via PIM | ≥ 50 real products |
| SC4 | Products live on Temu via PIM | ≥ 20 real products approved by Temu |
| SC5 | Orders routed to AW without manual steps | ≥ 5 real orders (PrestaShop) and ≥ 1 (Temu), 0 duplicates |
| SC6 | Tracking uploaded to Temu within Temu's deadline | 100% of POC Temu orders |
| SC7 | No sale below minimum margin | 0 occurrences (guard enforced) |

---

## 3. Blocking open questions and spikes (Phase 0)

These must be answered before the phase that depends on them. Each spike produces a short markdown note in `docs/spikes/` plus recorded fixtures.

| ID | Question | Blocks | How to resolve |
|---|---|---|---|
| S0.1 | **Where does AW expose tracking number and carrier?** No field in the documented order/transaction responses. | Phase 5 (Temu orders), G8 | Ask AW support; inspect a real `dispatched` order in `GET /dropshipping/order/{id}` in production for undocumented fields |
| S0.2 | Does `POST /dropshipping/clients` accept `country_code: "PT"` without `country_id`? | Phase 4 | Staging test; if not, build a `country_code → country_id` table from real responses |
| S0.3 | How is an AW order paid on submit (balance vs saved card)? What happens with insufficient balance? | Phase 4 | Staging test + AW support |
| S0.4 | Is AW `price` net of VAT? Currency of our channel (EUR `-dssk` vs GBP `-awd`)? | Phase 3 pricing | `GET /user-profile`, first products page, AW invoice |
| S0.5 | Rate limits of Aiku API; does `per_page=150` work on `/dropshipping/products`? | Phase 1 | Read `X-RateLimit-*` headers; try it |
| S0.6 | Columns of the portfolio data feed (CSV/JSON) | Phase 2 sync | Download once, store as fixture |
| S0.7 | Shipping cost per country/weight (only known after creating an order) | Phase 3 pricing | Create and delete draft orders in staging for PT, ES, FR, DE at 3 weights |
| S0.8 | **Temu EU Partner Platform**: exact method names, gateway host, signing algorithm, app approval, scopes for Local Seller (goods add, category/attribute tree, stock update, price update, order list/detail, shipping info decrypt, shipment confirm, carrier list) | Phase 5 | Read `partner-eu.temu.com` documentation with the Gemma seller account; register app; record fixtures |
| S0.9 | Temu EU compliance fields required per product (GPSR manufacturer / EU responsible person, safety info, CLP labels for oils/incense, restricted categories) | Phase 5 | Temu Seller Center + category attribute API; AW for manufacturer data |
| S0.10 | **PrestaShop 9 Admin API coverage**: products, combinations, images, stock, orders, order states and carriers tracking. Resources not covered must use the legacy Webservice. | Phase 3 | Open `/admin-api/docs.json` on gemmams.pt; list covered resources |
| S0.11 | How do current gemmams.pt products map to AW (by `reference` = AW `code`? by EAN?) | Phase 3 | Export PS catalogue, match script, report |

Known facts about Temu used in this PRD come from secondary sources and must be confirmed in S0.8: app key + secret + seller access token, every call signed; order lifecycle pending → awaiting shipment → shipped → delivered (cancel as side exit); handling time typically 1 to 2 business days; tracking to be posted within 24h of dispatch with a carrier from Temu's supported list; shipping address PII requires a dedicated scope and a decrypt call.

---

## 4. Architecture

### 4.1 Stack
* Backend: **NestJS** (TypeScript strict), modular monolith.
* Frontend: **Angular 22** (standalone, zoneless, signals, Signal Forms), minimal back office (`apps/web`, D3).
* DB: **PostgreSQL 16**. ORM: Prisma 7 (repo standard).
* Jobs: **BullMQ + Redis** (queues per connector, with rate limiting and retries).
* Storage: S3 compatible bucket (MinIO locally) for images.
* AI: commercial LLM API behind a thin replaceable client (`LlmClient` interface). No training on data.
* Observability: structured logs (pino), `sync_run` table as the operational audit, health endpoint.

### 4.2 Modules (adapted by D2 and D3)
```
apps/
  api/            NestJS (REST for the back office)
  worker/         BullMQ consumers (sync, sagas)
  cron/           schedulers
  web/            Angular 22 back office
packages/
  core-domain/    entities, value objects, pure rules (pricing, stock, hashing, state machines)
  connector-contracts/   ISourceConnector, IChannelConnector, DTOs
  connector-aw-aiku/     Source connector (AW Dropship / Aiku)
  connector-prestashop9/ Channel connector (Admin API + Webservice fallback)
  connector-temu-eu/     Channel connector (Temu Partner Platform EU)
  http-client/    resilient HTTP client (retry, backoff, rate limit, request log)
  testing-utils/  fixtures, builders, fakes (existing package, extended)
```

### 4.3 Connector contracts (must match TXPIM)

```ts
export interface ConnectorCapabilities {
  catalogRead?: boolean;      // source
  assortmentWrite?: boolean;  // source: add/remove from supplier portfolio
  stockRead?: boolean;
  costRead?: boolean;
  mediaRead?: boolean;
  dropshipOrderWrite?: boolean; // source: place order at supplier
  trackingRead?: boolean;
  listingWrite?: boolean;     // channel
  stockWrite?: boolean;       // channel
  priceWrite?: boolean;       // channel
  orderRead?: boolean;        // channel
  shipmentWrite?: boolean;    // channel: push tracking
  categoryTreeRead?: boolean; // channel
}

export interface ISourceConnector {
  readonly code: string; // 'aw-aiku'
  capabilities(): ConnectorCapabilities;
  testConnection(): Promise<ConnectionTestResult>;
  listCatalog(cursor?: PageCursor): Promise<Page<SupplierProductRaw>>;
  listAssortment(cursor?: PageCursor): Promise<Page<SupplierAssortmentItemRaw>>;
  addToAssortment(supplierProductId: string, overrides?: AssortmentOverrides): Promise<SupplierAssortmentItemRaw>;
  removeFromAssortment(assortmentId: string): Promise<void>;
  listMedia(ref: { kind: 'product' | 'assortment'; id: string }): Promise<SupplierMediaRaw[]>;
  placeDropshipOrder(cmd: PlaceDropshipOrderCommand): Promise<SupplierOrderResult>;
  getSupplierOrder(externalId: string): Promise<SupplierOrderStatus>;
}

export interface IChannelConnector {
  readonly code: string; // 'prestashop9' | 'temu-eu'
  capabilities(): ConnectorCapabilities;
  testConnection(): Promise<ConnectionTestResult>;
  upsertListing(listing: ChannelListingPayload): Promise<ChannelListingResult>;
  updateStock(items: StockUpdate[]): Promise<BatchResult>;
  updatePrice(items: PriceUpdate[]): Promise<BatchResult>;
  deactivateListing(externalId: string): Promise<void>;
  listOrdersSince(since: Date, cursor?: PageCursor): Promise<Page<ChannelOrderRaw>>;
  pushShipment(cmd: PushShipmentCommand): Promise<void>;
  getCategoryTree?(): Promise<ChannelCategory[]>;
  getCategoryAttributes?(categoryId: string): Promise<ChannelAttributeSpec[]>;
}
```

Rules:
* Connectors are **stateless adapters**: they translate, they do not decide. Business rules live in `core-domain`.
* Every connector call is wrapped by the resilient HTTP client and logged into `integration_request_log` (method, url without secrets, status, duration, correlation id).
* Every entity is scoped by `tenant_id`. Channel and stock contexts use `scope_id` (TXPIM `Scope`).

### 4.4 High level flows

```
AW/Aiku ──(poll catalog / feed)──► SupplierProduct (raw + hash)
                                      │ curate
                                      ▼
                         Product (golden record) ◄── enrichment (AI + human)
                                      │ pricing rules per channel
                           ┌──────────┴───────────┐
                           ▼                      ▼
                 ChannelListing(PS9)      ChannelListing(Temu EU)
                           │                      │
                    orders (poll)          orders (poll)
                           └──────────┬───────────┘
                                      ▼
                              ChannelOrder ──► SupplierOrder (AW: client → order → lines → submit)
                                      ▲                 │
                                      └── tracking ◄────┘ (auto if available, manual fallback)
```

---

## 5. Domain model

All tables have `id (uuid)`, `tenant_id`, `created_at`, `updated_at`. (Repo convention: Prisma models use `id String @id @default(cuid())`, `createdAt`, `updatedAt`, soft delete where applicable, snake_case table via `@@map`.)

| Entity | Key fields | Notes |
|---|---|---|
| `tenant` | name, slug | Gemma is tenant #1 |
| `supplier` | code (`aw-aiku`), name, credentials_enc, environment (`staging`/`production`), base_url | |
| `supplier_product` | supplier_id, external_id (AW product `id`), code, slug, ean, name, description_raw, department, sub_department, family, cost_price, currency, stock, gross_weight_g, image_main_url, raw_payload (jsonb), content_hash, first_seen_at, last_seen_at, status (`active`/`missing`) | One row per catalogue item. `content_hash` excludes stock and price (tracked separately) |
| `supplier_assortment_item` | supplier_product_id, external_portfolio_id, selling_price_at_supplier, quantity_left, status (`active`/`disabled`) | AW "my products" (portfolio). `external_portfolio_id` is what AW order lines need |
| `product` | sku (internal), ean, supplier_product_id, title_pt, description_pt_html, short_description_pt, brand, weight_g, status (`draft`/`ready`/`published`/`archived`), enrichment_status (`none`/`ai_draft`/`approved`), attributes (jsonb), compliance (jsonb: manufacturer, eu_responsible_person, safety_warnings) | Golden record |
| `product_media` | product_id, source_url, storage_key, width, height, mime, position, checksum | Downloaded from AW `source.original` |
| `category` / `category_mapping` | internal tree; mapping `supplier (department/sub/family)` → internal → `channel category id` | Mapping by normalized name, history kept |
| `price_rule` | scope (channel), priority, condition (jsonb), markup_pct, fixed_add, rounding (`x.99`/`x.90`/none), min_margin_pct, vat_rate | |
| `channel` | code (`prestashop9`, `temu-eu`), credentials_enc, settings (jsonb), scope_id | |
| `channel_listing` | product_id, channel_id, external_id, external_variant_id, status (`pending`/`submitted`/`live`/`rejected`/`inactive`), last_price, last_stock, last_payload_hash, last_error, last_synced_at | |
| `channel_order` | channel_id, external_id, external_status, placed_at, customer (jsonb, PII encrypted), shipping_address (jsonb, PII encrypted), lines (jsonb), totals, currency, internal_status | Idempotent on (channel_id, external_id) |
| `supplier_order` | channel_order_id, supplier_id, external_client_id, external_order_id, external_reference, state (`creating`/`submitted`/`dispatched`/`failed`/`cancelled`), totals from AW, last_error | Idempotent on channel_order_id |
| `shipment` | channel_order_id, carrier_code, carrier_name, tracking_number, source (`supplier_api`/`manual`), pushed_to_channel_at, push_error | |
| `sync_run` | kind, connector, started_at, finished_at, status, counters (jsonb), error_summary | |
| `integration_request_log` | connector, method, url, status, duration_ms, correlation_id, error | 30 days retention |
| `audit_event` | actor, entity, entity_id, action, diff (jsonb) | |

---

## 6. Functional requirements

Each FR lists acceptance criteria (AC). Every AC must be covered by at least one unit test written **before** the implementation (see section 12).

### 6.1 Supplier connector: AW/Aiku (`packages/connector-aw-aiku`)

**FR-AW-001 Authentication and environments**
* AC1: Base URL is `https://api.aiku.io` (production) or `https://api.aiku-sandbox.uk` (staging), chosen by `supplier.environment`.
* AC2: Every request sends `Authorization: Bearer <token>` and `Accept: application/json`.
* AC3: `testConnection()` calls `GET /user-profile` and returns ok with account name, currency (if present) and `balance`; 401 returns `invalid_credentials` without throwing.
* AC4: The token never appears in logs, errors or `integration_request_log`.

**FR-AW-002 Pagination**
* AC1: The paginator follows Laravel style responses (`data`, `links.next`, `meta.current_page`, `meta.last_page`) and stops when `links.next` is null or `current_page >= last_page`.
* AC2: `per_page` is configurable (default 50, max 150).
* AC3: A page failure is retried (see FR-HTTP-001) and, if still failing, the run is marked `partial` with the failed page recorded; already processed pages are kept.

**FR-AW-003 Catalogue mapping**
* AC1: `GET /dropshipping/products?include=department,sub_department,family` maps to `SupplierProductRaw` with: `external_id=id`, `code`, `slug`, `ean=ean_barcode`, `name`, `description`, `description_extra`, `department_name`, `sub_department_name`, `family_name`, `cost_price=parseDecimal(price)`, `currency=currency_code`, `stock=current_stock`, `gross_weight_g=gross_weight`, `image_main_url=image.original_2x ?? image.original`.
* AC2: Monetary strings are parsed to decimal (no floats; use a decimal library). Numbers are also accepted.
* AC3: Null `description` is allowed and does not fail the mapping.
* AC4: Unknown extra fields are preserved in `raw_payload`.

**FR-AW-004 Portfolio (assortment)**
* AC1: `addToAssortment(productId)` calls `POST /dropshipping/products/my-products/{product_id}/store` and returns `external_portfolio_id = data.id` and `item_id`.
* AC2: `listAssortment` maps `GET /dropshipping/products/my-products` (`id`, `item_id`, `code`, `quantity_left`, `weight`, `price`, `selling_price` when present).
* AC3: `removeFromAssortment` calls `DELETE .../my-products/{id}/delete`; a response indicating disable instead of delete is treated as success with status `disabled`.

**FR-AW-005 Media**
* AC1: `listMedia` calls `GET /dropshipping/images?id={id}&type={product|portfolio}` and returns items with `source.original` as the download URL, plus `name`, `mime_type`, `uuid`.
* AC2: Thumbnails are ignored.

**FR-AW-006 Dropship order placement** (idempotent saga)
Given a `PlaceDropshipOrderCommand` (channel order ref, recipient, address, lines with `external_portfolio_id` and quantity):
* AC1: Step 1 find or create client: search `GET /dropshipping/clients?search=<email>`; if an active client with same email and same address checksum exists, reuse it; otherwise `POST /dropshipping/clients` with `company_name = recipient full name` (required field), `contact_name`, `email`, `phone`, `address`.
* AC2: Step 2 `POST /dropshipping/order/client/{client_id}/store`.
* AC3: Step 3 for each line `POST /dropshipping/order/{order}/portfolio/{portfolio}/store` with `{ "quantity_ordered": n }`.
* AC4: Step 4 `PATCH /dropshipping/order/{order}/update` with `public_notes = "<CHANNEL>-<external order id>"`.
* AC5: Step 5 `GET /dropshipping/order/{order}` and validate: `item_quantity` equals the sum of lines; `total_amount` is below `max_supplier_cost` from the command, otherwise abort before submitting (order stays `creating`, alert raised).
* AC6: Step 6 `PATCH /dropshipping/order/{order}/submit`; the state becomes `submitted`.
* AC7: Every step persists progress in `supplier_order` so a retry resumes from the last completed step and **never creates a second AW order** for the same channel order.
* AC8: If a step fails after the order is created and before submit, the saga retries; after max retries it marks `failed` and does **not** delete the AW order automatically (manual decision in the back office).
* AC9: Phone and email missing from the channel (Temu may hide them) are replaced by configured tenant defaults, never left empty.

**FR-AW-007 Supplier order status and tracking**
* AC1: `getSupplierOrder` returns state, totals and per line `quantity_dispatched`, `quantity_fail`, `quantity_cancelled` from `/transactions`.
* AC2: If S0.1 finds tracking fields, they are mapped to `shipment` with `source=supplier_api`. Until then the method returns `tracking: null`.
* AC3: Any line with `quantity_fail > 0` or `quantity_cancelled > 0` raises an alert on the channel order.

### 6.2 Resilient HTTP (`packages/http-client`)

**FR-HTTP-001**
* AC1: Retries on network errors, 429 and 5xx with exponential backoff and jitter (base 500 ms, max 5 attempts); honours `Retry-After`.
* AC2: No retry on 4xx other than 408/429.
* AC3: Per connector token bucket rate limiter (configurable; defaults AW 2 req/s, PS 5 req/s, Temu per S0.8).
* AC4: Each request gets a correlation id and is written to `integration_request_log` with secrets redacted.

### 6.3 Ingestion and change detection

**FR-ING-001 Full catalogue sync** (job `aw.catalog.full`, daily at 03:30 Europe/Lisbon and on demand)
* AC1: Upserts `supplier_product` by (`supplier_id`, `external_id`).
* AC2: `content_hash` = SHA-256 of a canonical JSON of content fields (name, descriptions, ean, categories, weight, image url). If unchanged, no content write happens.
* AC3: Products not seen in a complete run are marked `missing` (not deleted). A linked `product` gets flagged and its listings are set to stock 0.
* AC4: Counters stored in `sync_run`: seen, created, content_changed, price_changed, stock_changed, missing, errors.
* AC5: A second consecutive run with no source changes produces `created=0, content_changed=0`.

**FR-ING-002 Stock and cost sync** (job `aw.stock.sync`, every 30 min)
* AC1: For assortment items only, uses the portfolio data feed (JSON) when S0.6 confirms it has stock and cost; otherwise pages `my-products`.
* AC2: Writes stock and cost changes and enqueues channel updates only for changed products.
* AC3: A cost change that breaks the minimum margin on any channel sets that listing to `inactive` (stock 0) and raises an alert (see FR-PRC-001 AC4).

### 6.4 Curation and enrichment

**FR-CUR-001 Assortment selection**
* AC1: From the supplier catalogue list, the user selects products and clicks "Add to Gemma". The system calls `addToAssortment`, creates `supplier_assortment_item` and a `product` in `draft`.
* AC2: Product defaults: `sku = AW code`, `ean`, `title_pt = name` (to translate), `weight_g`, categories mapped when a mapping exists.
* AC3: Removing a product archives it, deactivates its listings and removes it from the AW portfolio.

**FR-ENR-001 Media import**
* AC1: For each new product, downloads all `source.original` images into storage, computes checksum, dedupes by checksum, sets position by API order.
* AC2: Channels receive our storage URLs (never AW hotlinks).

**FR-ENR-002 AI enrichment (PT-PT)**
* AC1: "Generate" builds a prompt from supplier name, description (HTML stripped), categories and attributes and asks the `LlmClient` for JSON `{ title_pt, short_description_pt, description_pt_html, bullet_points[], seo_title, seo_description, suggested_attributes{} }`.
* AC2: Output is validated with a schema; invalid output is rejected and shown as error, never saved.
* AC3: Title ≤ 128 chars; SEO title ≤ 60; SEO description ≤ 160; HTML sanitized to an allow list.
* AC4: Result saved as `ai_draft`; only a human "Approve" sets `approved`. Publishing requires `approved`.
* AC5: The prompt forbids health or therapeutic claims about crystals and oils (regulatory risk) and the validator rejects outputs containing a configurable list of forbidden terms (e.g. "cura", "trata", "medicinal").
* AC6: Tokens used per call are logged (input, output, model) for cost visibility.

**FR-CAT-001 Category mapping**
* AC1: Screen to map each distinct `department / sub_department / family` to an internal category, a PrestaShop category id and a Temu category id.
* AC2: Temu category selection loads required attributes (`getCategoryAttributes`) and stores which are mandatory.
* AC3: A product cannot be published to a channel if its category has no mapping for that channel or if mandatory channel attributes are missing (validation lists what is missing).

### 6.5 Pricing and stock rules (`packages/core-domain`, pure functions)

**FR-PRC-001 Price calculation**
Inputs: supplier cost (net), estimated shipping cost to PT for the weight (from S0.7 table, 0 if free shipping is absorbed), channel rule, VAT rate.
* AC1: `net = (cost + shipping_absorbed) × (1 + markup_pct) + fixed_add`; `gross = net × (1 + vat_rate)`; apply rounding rule to `gross`.
* AC2: The first matching rule by priority wins (conditions: channel, category, cost range, product tag).
* AC3: `margin_pct = (net_after_rounding − cost − shipping_absorbed − channel_fee) / net_after_rounding`; channel_fee from channel settings (Temu commission, PS payment fee).
* AC4: If `margin_pct < min_margin_pct` the result is `blocked` with a reason; blocked prices are never sent to a channel.
* AC5: Currency is EUR; decimals are handled with a decimal library; results rounded to 2 decimals.
* AC6: Manual price override per product and channel is allowed but still passes the margin guard unless the user explicitly forces it (audited).

**FR-STK-001 Available stock per channel**
* AC1: `available = max(0, supplier_stock − safety_buffer)`; buffer configurable per channel (default PS 2, Temu 5).
* AC2: Optional cap per channel (e.g. Temu max 50) to limit exposure.
* AC3: Product not `published`, supplier product `missing`, or assortment item `disabled` means available 0.

### 6.6 Channel connector: PrestaShop 9 (`packages/connector-prestashop9`)

**FR-PS-001 Authentication**
* AC1: Admin API via OAuth2 client credentials (internal authorization server); token cached until 60 s before expiry. Scopes: `product_read`, `product_write` plus others identified in S0.10.
* AC2: Resources not covered by the Admin API (S0.10) use the legacy Webservice with its key; the adapter hides which transport is used.

**FR-PS-002 Upsert listing**
* AC1: Creates or updates the product by `reference = sku`; stores returned id in `channel_listing.external_id`.
* AC2: Sends name, descriptions, EAN13, weight (kg = g/1000), price tax excluded with the configured tax rule group, category ids, active flag, SEO fields.
* AC3: Images uploaded from our storage; re-upload only when the image checksum set changed.
* AC4: `last_payload_hash` prevents sending unchanged payloads.
* AC5: Existing PrestaShop products are matched first (S0.11) to avoid duplicates: match by reference, then EAN.

**FR-PS-003 Stock and price updates**
* AC1: Batch updates of stock (stock_availables) and price for changed listings only.
* AC2: Partial failures are reported per item in `BatchResult` and do not abort the batch.

**FR-PS-004 Orders**
* AC1: Poll orders since the last cursor every 10 min; import only orders in states configured as "paid" (e.g. Payment accepted).
* AC2: Idempotent on (channel, external order id).
* AC3: An order with any line whose product is not in the PIM is flagged `manual_review`, not sent to AW.
* AC4: On import of an eligible order, enqueue FR-AW-006.
* AC5: `pushShipment` sets the tracking number on the order carrier and moves the order to the "Shipped" state.

### 6.7 Channel connector: Temu EU (`packages/connector-temu-eu`)

Method names and payloads are finalized in spike S0.8. The adapter must isolate them behind `IChannelConnector`.

**FR-TEMU-001 Authentication and signing**
* AC1: App key, app secret and seller access token stored encrypted; every request signed per Temu's algorithm (implemented as a pure function with test vectors from Temu docs).
* AC2: EU gateway host configurable (not hardcoded).
* AC3: Expired or revoked token surfaces as `reauthorization_required` on the channel status screen.

**FR-TEMU-002 Listing creation**
* AC1: Only products with approved enrichment, mapped Temu category, all mandatory attributes, at least 3 images (or Temu minimum) and compliance fields (S0.9) can be submitted.
* AC2: After submit, listing status `submitted`; a job polls review status and moves to `live` or `rejected` storing Temu's reason.
* AC3: Price updates respect that Temu may review price changes; pending price changes are tracked and not re-sent while pending.

**FR-TEMU-003 Stock sync**
* AC1: Pushes `available` (FR-STK-001) for changed listings every sync cycle.

**FR-TEMU-004 Orders**
* AC1: Poll order list every 10 min (Temu expects short polling cycles) for status awaiting shipment.
* AC2: Shipping address obtained via the shipping info / decrypt call with the dedicated scope; stored encrypted, retained only until 90 days after delivery then purged.
* AC3: Idempotent import; enqueue FR-AW-006 with `max_supplier_cost` computed from the order total minus the minimum margin.
* AC4: Ship-by deadline stored; an alert fires when a Temu order has no tracking 12 h before the deadline.

**FR-TEMU-005 Shipment confirmation**
* AC1: `pushShipment` maps our carrier code to Temu's carrier list (table maintained in settings) and posts carrier + tracking.
* AC2: Unknown carrier blocks the push with an explicit error (never guess).

### 6.8 Order orchestration

**FR-ORD-001 State machine** (pure, in `core-domain`)
```
imported → routing → supplier_submitted → supplier_dispatched → tracking_pushed → completed
        ↘ manual_review            ↘ supplier_failed         ↘ tracking_missing (alert)
        ↘ cancelled (channel)
```
* AC1: Only the transitions above are allowed; invalid transitions throw a domain error.
* AC2: A channel cancellation while the AW order is still `creating` deletes the AW draft (`DELETE .../order/{id}/delete`); if already `submitted`, flags `manual_review` (AW has no documented cancel endpoint).

**FR-ORD-002 Manual tracking fallback** (until S0.1 is solved)
* AC1: Back office screen lists `supplier_submitted` orders with a form for carrier + tracking number.
* AC2: Saving creates `shipment(source=manual)` and triggers `pushShipment` on the originating channel.

### 6.9 Back office (Angular 22, `apps/web`)

Screens (minimal, functional, no design polish):
1. **Dashboard**: last `sync_run` per job, error counts, alerts (margin blocked, missing products, Temu deadlines, failed orders).
2. **Supplier catalogue**: paginated table with search, department/family filters, stock, cost, "Add to Gemma" (bulk).
3. **Products**: list with status chips per channel; detail with tabs Info, Media, Enrichment (generate/approve), Pricing (computed price and margin per channel), Channels (listing status, errors, publish/unpublish).
4. **Category mapping**.
5. **Price rules**.
6. **Orders**: channel orders with state machine status, AW order link, manual tracking form, retry action.
7. **Settings**: supplier and channel credentials (write only fields), environments, sync schedules, carrier mapping, tenant defaults (phone/email).

Auth: Better Auth (D4), single admin user for the POC. RBAC out of scope.

---

## 7. Non functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | Idempotency: every job and saga step is safe to re-run |
| NFR-02 | All money in decimals, all times in UTC in DB, displayed in Europe/Lisbon |
| NFR-03 | Secrets encrypted at rest, redacted in logs, never returned by the API |
| NFR-04 | PII (Temu addresses, customer data) encrypted at field level and purged per retention rules (GDPR) |
| NFR-05 | Staging first: every connector must run against AW staging before production; staging resets every Sunday 03:00 UTC, so staging fixtures cannot rely on persistent ids |
| NFR-06 | Full catalogue sync ≤ 30 min at 2 req/s |
| NFR-07 | Docker Compose for local (api, web, postgres, redis, minio) |
| NFR-08 | CI runs lint, typecheck, unit tests, coverage gate, integration tests |

---

## 8. Phases and acceptance

| Phase | Content | Exit criteria |
|---|---|---|
| **P0 Spikes** | S0.1 to S0.11 | Notes + fixtures committed; blocking answers known (S0.1 at least escalated) |
| **P1 Foundations + AW read** | Repo, CI, test harness, HTTP client, AW connector read side, FR-ING-001 | SC1 met against production (read only) |
| **P2 Curation + enrichment** | FR-CUR-001, FR-ENR-001/002, FR-CAT-001, FR-ING-002 | 50 products approved in PIM |
| **P3 PrestaShop publish** | FR-PRC-001, FR-STK-001, FR-PS-001/002/003 | SC3, SC2 (PS), SC7 |
| **P4 PrestaShop orders → AW** | FR-AW-006/007, FR-PS-004, FR-ORD-001/002 | SC5 (PS) |
| **P5 Temu** | FR-TEMU-001..005 | SC4, SC5 (Temu), SC6 |

Temu goes last on purpose: it depends on S0.1 (tracking), S0.8 (app approval) and S0.9 (compliance), which are outside our control.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| AW exposes no tracking via API | Temu SLA breaches, account penalties | Manual fallback FR-ORD-002; do not scale Temu until solved |
| Temu app approval / compliance (GPSR, CLP for oils and incense, restricted categories) | Listings rejected | Start S0.8/S0.9 in week 1; start with low risk categories (crystals, décor) |
| Temu margins and commission | Unprofitable sales | Margin guard FR-PRC-001, channel fee in formula |
| AW stock drift between syncs | Overselling | Safety buffer, 30 min sync, caps on Temu |
| PS9 Admin API incomplete | Extra work via Webservice | Transport abstraction FR-PS-001 AC2 |
| Health claims in AI content | Regulatory and marketplace risk | Prompt rules + forbidden terms validator |
| Scope creep into full TXPIM | POC never ends | This PRD is the boundary; anything else goes to the TXPIM backlog |

---

## 10. Out of scope (explicit)
Other suppliers, returns/RMA, invoicing, multi language, marketplace other than Temu, SaaS features (plans, billing, AI credits), RBAC, full DAM, price intelligence.

---

## 11. Definition of Done (per FR)
1. Unit tests for every AC written first and committed red, then green.
2. Coverage gate met for touched modules.
3. Contract tests green against fixtures.
4. No secret or PII in logs (tested).
5. Back office path to operate the feature exists (where applicable).
6. `docs/` updated (behaviour, config, runbook line).

---

## 12. Test catalogue (write these before the code)

### 12.1 Unit tests: `core-domain`

**Pricing (`pricing.spec.ts`)**
* computes net and gross for cost 10.00, markup 100%, VAT 23%, rounding x.99 → gross 24.99 (net recomputed from rounded gross).
* picks the highest priority matching rule when several match.
* falls back to the default rule when no condition matches.
* returns `blocked` when margin after channel fee is below `min_margin_pct`.
* includes absorbed shipping in cost base.
* handles cost as string "0.94" and number 0.94 identically.
* never produces negative or zero prices.
* forced override passes but is flagged `forced=true`.

**Stock (`stock.spec.ts`)**
* stock 10, buffer 2 → 8; stock 1, buffer 2 → 0.
* cap applied after buffer.
* returns 0 when product not published, supplier product missing or assortment disabled.

**Hashing (`content-hash.spec.ts`)**
* same content with different key order → same hash.
* price or stock change → same content hash.
* name change → different hash.

**Order state machine (`order-state.spec.ts`)**
* every allowed transition succeeds; every other pair throws.
* cancel while `creating` returns action `delete_supplier_draft`; while `submitted` returns `manual_review`.

**Enrichment validator (`enrichment-validator.spec.ts`)**
* rejects missing fields, over length title, forbidden terms (case and accent insensitive), disallowed HTML tags; accepts a valid payload.

### 12.2 Unit tests: connectors (HTTP mocked)

**AW (`connector-aw-aiku/*.spec.ts`)**, fixtures from the companion doc examples:
* sends bearer and accept headers; picks base URL by environment.
* `testConnection` ok on 200 profile; `invalid_credentials` on 401; token absent from logged request.
* paginator walks 3 pages and stops on `links.next=null`; stops on `current_page=last_page`.
* catalogue mapper maps the `AAL-07` example exactly (cost 0.94, stock 267, weight 19, EUR, department/sub/family).
* mapper tolerates null description and unknown fields.
* portfolio store returns `external_portfolio_id=3761386` from the store example.
* delete portfolio treats "Portfolio has been deleted." as success.
* images mapper returns `source.original` and ignores thumbnails.
* saga happy path calls client search, client create, order store, 2× transaction store, order update (public_notes), order get, submit, in that order.
* saga reuses existing client when email and address match.
* saga resumes from step 3 after a failure at step 3 and does not call order store again.
* saga aborts before submit when `total_amount` > `max_supplier_cost`.
* saga fills missing phone/email with tenant defaults.
* `getSupplierOrder` raises alert flag when a transaction has `quantity_fail > 0`.

**HTTP (`resilient-http.spec.ts`)**
* retries 429 honouring Retry-After; retries 503 up to 5 times; does not retry 400/404/422.
* rate limiter spaces calls to configured rate (fake timers).
* redacts `Authorization`, `token`, `secret`, `password` in logs.

**PrestaShop 9 (`connector-prestashop9/*.spec.ts`)**
* OAuth token cached and refreshed 60 s before expiry.
* upsert creates when reference not found, updates when found; skips when payload hash unchanged.
* weight converted g → kg; price sent tax excluded.
* batch stock update reports partial failures per item.
* order import filters by paid states and is idempotent.
* order with unknown SKU → `manual_review`.

**Temu (`connector-temu-eu/*.spec.ts`)**
* signature function matches Temu doc test vectors (added in S0.8).
* listing validation blocks when category mapping, mandatory attributes, images or compliance fields are missing, listing exactly what is missing.
* review polling moves `submitted` → `live` / `rejected` with reason.
* pending price change not re-sent.
* unknown carrier blocks shipment push.
* deadline alert fires 12 h before ship-by with no tracking.
* PII fields encrypted before persistence.

### 12.3 Contract tests
Recorded real responses (staging and production, anonymized) for AW, PS9 and Temu replayed against the mappers. A mapper change that breaks a recorded contract fails CI.

### 12.4 Integration tests (Testcontainers)
* full catalogue sync of 3 fixture pages into Postgres; second run writes 0 content updates.
* curated product → PS listing job → stock change → only that listing updated.
* PS paid order → AW saga (mocked HTTP) → manual tracking → PS shipment push.
* job retry after crash mid saga resumes without duplicate AW order.

### 12.5 Frontend unit tests (Jest, Angular 22)
* catalogue table: search and filters build the right query params; bulk "Add to Gemma" disabled with 0 selected.
* product enrichment tab: "Approve" disabled until a valid AI draft exists; validation errors shown.
* pricing tab shows `blocked` badge and reason.
* manual tracking form requires carrier and tracking; submit calls API once (no double submit).
* settings: credential fields are write only (never prefilled).

---

## 13. Deliverables
* Repo with the structure in 4.2, Docker Compose, CI.
* `docs/spikes/*.md`, `docs/open-questions.md`, `docs/runbook.md`.
* Recorded fixtures per connector.
* POC report: success criteria table filled with real numbers, list of what migrates to TXPIM as is and what needs redesign.
