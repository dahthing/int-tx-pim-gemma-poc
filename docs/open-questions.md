# Open questions

Single register of the Phase 0 spikes (PRD section 3). Every one is **OPEN**: nothing below has been confirmed against
the real systems. "Assumption in code" is what the implementation does today, and "Where isolated" is the only place to
change when the answer arrives. Details and numbered assumptions: [spikes/README.md](spikes/README.md).

How to read the status column: OPEN (not started or no answer), ANSWERED (answer known, code not yet adjusted), CLOSED
(answer recorded, fixtures replaced, code adjusted). Update this file in the same commit that changes the code.

Who to ask uses roles, not names: fill in the real contact when known. "Owner" is Rui Guedes (TargX), who holds the
Gemma accounts.

## Summary

| ID    | Question                                  | Status | Blocks                            |
| ----- | ----------------------------------------- | ------ | --------------------------------- |
| S0.1  | Tracking number and carrier in AW         | OPEN   | Temu orders (P5), G8, SC6         |
| S0.2  | `country_code: "PT"` without `country_id` | OPEN   | P4 (orders to AW)                 |
| S0.3  | Payment on AW order submit                | OPEN   | P4, SC5                           |
| S0.4  | AW `price` net of VAT, channel currency   | OPEN   | P3 pricing, SC7                   |
| S0.5  | AW rate limits, `per_page=150`            | OPEN   | P1 (SC1 time budget)              |
| S0.6  | Portfolio data feed columns               | OPEN   | P2 stock sync (optimisation only) |
| S0.7  | Shipping cost per country and weight      | OPEN   | P3 pricing accuracy, SC7          |
| S0.8  | Temu EU Partner Platform API              | OPEN   | P5, SC4, SC5 (Temu), SC6          |
| S0.9  | Temu EU compliance fields                 | OPEN   | P5, SC4                           |
| S0.10 | PrestaShop 9 Admin API coverage           | OPEN   | P3, SC3                           |
| S0.11 | gemmams.pt products to AW mapping         | OPEN   | P3 (duplicates on first publish)  |

## S0.1 Where does AW expose tracking number and carrier?

- **Status:** OPEN. Blocking for Temu (PRD risk: SLA breach, account penalties).
- **What blocks it:** no tracking field in the documented order or transaction responses. Needs a real `dispatched`
  order in production (`GET /dropshipping/order/{id}`) or a written answer from AW.
- **Who to ask:** AW Dropship support / account manager (Aiku API owner). Owner to provide a real dispatched order id.
- **Assumption in code:** tracking is not available. `getSupplierOrder` maps `tracking_number` and `carrier` or
  `carrier_name` defensively if the order payload happens to carry them, otherwise returns `tracking: null`; the
  source capability `trackingRead` is `false`; the operator enters carrier and tracking by hand (FR-ORD-002).
- **Where isolated:** `packages/connector-aw-aiku/src/aw-aiku.connector.ts` (`getSupplierOrder`),
  `packages/pim-runtime/src/adapters/source-connector.proxy.ts` (capabilities),
  `packages/pim-orders/src/supplier-order-status.service.ts` (shipment with `SUPPLIER_API` when tracking exists,
  alert `tracking_missing` otherwise), manual path in `packages/pim-orders/src/shipment.service.ts`.
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md) item 8.

## S0.2 Does `POST /dropshipping/clients` accept `country_code: "PT"` without `country_id`?

- **Status:** OPEN.
- **What blocks it:** a staging call, or a `country_code` to `country_id` table built from real responses.
- **Who to ask:** nobody needed if staging access exists (Owner); otherwise AW support.
- **Assumption in code:** accepted. The client is created with `address.country_code` only.
- **Where isolated:** `packages/connector-aw-aiku/src/aw-aiku.connector.ts` (`findOrCreateClient`).
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md) item 6.

## S0.3 How is an AW order paid on submit, and what happens with insufficient balance?

- **Status:** OPEN.
- **What blocks it:** staging test plus AW support. Until known, an unpaid or rejected submit is indistinguishable
  from any other HTTP failure.
- **Who to ask:** AW support / billing contact.
- **Assumption in code:** `PATCH .../submit` succeeds and payment is handled on the AW side (balance). There is no
  pre-check of balance. A rejected submit becomes saga state `failed` (the AW order is kept) and the order needs a
  manual decision. `testConnection` returns the balance for display.
- **Where isolated:** saga submit step in `packages/connector-aw-aiku/src/aw-aiku.connector.ts`
  (`placeDropshipOrder`), failure handling in `packages/pim-orders/src/supplier-order-saga.service.ts`.
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md) items 7, 12.

## S0.4 Is AW `price` net of VAT? Channel currency (EUR `-dssk` vs GBP `-awd`)?

- **Status:** OPEN.
- **What blocks it:** `GET /user-profile`, the first products page and an AW invoice for the Gemma account.
- **Who to ask:** AW account manager; Owner for the invoice.
- **Assumption in code:** price is net of VAT, currency EUR, money kept as decimal strings. Pricing treats supplier
  cost as net. A GBP account would be wrong (no FX handling).
- **Where isolated:** `packages/connector-aw-aiku/src/aw-mappers.ts` (`mapProduct`, `parseDecimal`),
  `packages/pim-runtime/src/listing/pricing-input.builder.ts` and `packages/pim-catalog/src/pricing.service.ts`
  (cost fed to `@repo/core-domain` `calculatePrice`).
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md) items 1, 11.

## S0.5 Rate limits of the Aiku API; does `per_page=150` work on `/dropshipping/products`?

- **Status:** OPEN.
- **What blocks it:** read the `X-RateLimit-*` headers on a real call and try `per_page=150`. Needed to confirm the
  30 min budget of SC1 (about 7 200 products, 50 per page at 2 req/s is about 72 s of HTTP, so the budget is
  comfortable unless the limit is far lower than assumed).
- **Who to ask:** AW support, or measure it (Owner).
- **Assumption in code:** 2 requests per second, `per_page` default 50 (max 150 accepted), HTTP client honours
  `Retry-After` on 429. `X-RateLimit-*` headers are not read.
- **Where isolated:** `packages/connector-aw-aiku/src/aw-aiku.connector.ts` (options `requestsPerSecond`,
  `perPage`), `packages/http-client/src/rate-limiter.ts`.
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md).

## S0.6 Columns of the portfolio data feed (CSV/JSON)

- **Status:** OPEN. Optimisation only, not blocking.
- **What blocks it:** download the feed once and store it as a fixture.
- **Who to ask:** AW support (where the feed lives), Owner to download.
- **Assumption in code:** no feed. FR-ING-002 pages `my-products` (`listAssortment`) every 30 minutes.
- **Where isolated:** `packages/pim-catalog/src/stock-cost-sync.service.ts`, `listAssortment` in the AW connector.
- **Doc:** [spikes/aw-aiku-assumptions.md](spikes/aw-aiku-assumptions.md) item 3.

## S0.7 Shipping cost per country and weight

- **Status:** OPEN.
- **What blocks it:** only known after creating an order. Needs draft orders in staging for PT, ES, FR, DE at 3 weights
  (then delete the drafts).
- **Who to ask:** staging access (Owner); AW support for their shipping price list.
- **Assumption in code:** no table. A single flat `shippingAbsorbed` (channel setting `settings.shippingAbsorbed`, and
  `PIM_ORDER_SHIPPING_ABSORBED` for the order cost cap) is added to the cost base. Margin is therefore optimistic for
  heavy or non-PT parcels.
- **Where isolated:** `packages/pim-runtime/src/listing/pricing-input.builder.ts`,
  `packages/pim-catalog/src/pricing.service.ts`, `packages/pim-runtime/src/adapters/config-order-settings.provider.ts`.
- **Doc:** none yet (no assumption note; add one when the table is designed).

## S0.8 Temu EU Partner Platform: methods, gateway, signing, approval, scopes

- **Status:** OPEN. Blocks all of Phase 5.
- **What blocks it:** read `partner-eu.temu.com` with the Gemma seller account, register the app and wait for
  approval, record fixtures and the official signing test vectors.
- **Who to ask:** Temu Partner Platform support / Seller Center; Owner for the seller account.
- **Assumption in code:** every method name, payload, envelope, error code, the signing algorithm (sorted
  key+value concatenation wrapped in the secret, MD5) and the carrier table are placeholders. Signing test vectors in
  the spec are computed from that same assumption, not from Temu.
- **Where isolated:** `packages/connector-temu-eu/src/signing.ts` (swap the `Signer`), `temu-api.ts` (methods,
  envelope, payloads, error codes), `carriers.ts` (carrier table), gateway host is configuration
  (`settings.gatewayHost`).
- **Doc:** [spikes/temu-eu-assumptions.md](spikes/temu-eu-assumptions.md) A1 to A13, A20 to A27.

## S0.9 Temu EU compliance fields per product (GPSR, safety, CLP, restricted categories)

- **Status:** OPEN.
- **What blocks it:** Temu Seller Center and the category attribute API; manufacturer data from AW.
- **Who to ask:** Temu seller support; AW for manufacturer and EU responsible person per product.
- **Assumption in code:** required fields are `gpsr_manufacturer`, `gpsr_eu_responsible_person`,
  `safety_information`, plus `clp_label` when `compliance.clpApplicable` is true; minimum 3 images. The data lives in
  `product.compliance` (JSON), which nothing populates automatically.
- **Where isolated:** `packages/connector-temu-eu/src/listing-validator.ts` (configurable
  `validation.requiredComplianceFields`, `validation.minImages`).
- **Doc:** [spikes/temu-eu-assumptions.md](spikes/temu-eu-assumptions.md) A14 to A17.

## S0.10 PrestaShop 9 Admin API coverage

- **Status:** OPEN.
- **What blocks it:** open `/admin-api/docs.json` on gemmams.pt and list covered resources; real token endpoint and
  field names; whether JSON writes work on the legacy Webservice.
- **Who to ask:** Owner (shop admin of gemmams.pt); PrestaShop developer docs for version specifics.
- **Assumption in code:** products, orders, customers, addresses, countries, shops on the Admin API;
  stock_availables, order_carriers, order_histories and images on the Webservice; camelCase Admin API fields,
  snake_case Webservice fields. Routing is overridable per resource (`settings.routing`).
- **Where isolated:** `packages/connector-prestashop9/src/endpoints.ts` (paths, envelopes, query syntax),
  `mapper.ts` (field names), `DEFAULT_ROUTING`.
- **Doc:** [spikes/prestashop9-assumptions.md](spikes/prestashop9-assumptions.md) items 1 to 27.

## S0.11 How do current gemmams.pt products map to AW (reference = AW `code`? EAN?)

- **Status:** OPEN.
- **What blocks it:** export the PrestaShop catalogue and run a match report against the AW catalogue.
- **Who to ask:** Owner (export from the shop).
- **Assumption in code:** PIM `sku` equals the AW `code` and the PrestaShop `reference`; upsert matches an existing
  product by `reference` first, then by EAN. The match script and report are **not implemented**.
- **Where isolated:** `packages/pim-catalog/src/curation.service.ts` (sku = AW code),
  `packages/connector-prestashop9` upsert matching (`connector.ts`).
- **Doc:** [spikes/prestashop9-assumptions.md](spikes/prestashop9-assumptions.md) items 22, 24.
