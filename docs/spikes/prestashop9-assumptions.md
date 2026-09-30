# PrestaShop 9 connector: assumptions (spike S0.10 / S0.11 unresolved)

No real PS9 Admin API docs or recorded responses were available. Everything below is ASSUMED, isolated in
`packages/connector-prestashop9/src/endpoints.ts` (paths, envelopes, query syntax) and `mapper.ts` (field names),
and pinned by fixtures in `src/__fixtures__/` (replayed by `contract.spec.ts`). Replace the fixtures with recorded
responses and fix the two files when S0.10 closes.

## Transport routing
1. Default routing (`DEFAULT_ROUTING`): products, orders, customers, addresses, countries, shops -> Admin API;
   stock_availables, order_carriers, order_histories, images -> Webservice. Override per resource with `settings.routing`.
2. The connector fails at construction if a routed transport has no credentials.

## Admin API
3. Base path `/admin-api`; token endpoint `{baseUrl}/admin-api/access_token` (override `adminApi.tokenUrl`); form-encoded
   `grant_type=client_credentials`, `client_id`, `client_secret`, optional space-separated `scope`; JSON reply
   `{access_token, expires_in}` (`expires_in` defaults to 3600 when absent).
4. Resource paths are kebab-case plural (`stock-availables`, `order-carriers`, `order-histories`).
5. List reply is `{ items: [...] }`; single reads/writes are the flat object. Empty list = `items: []`.
6. Update uses `PATCH` with a partial body (no read-merge).
7. Field names are camelCase: `productId`, `stockAvailableId`, `orderId`, `currentState`, `dateAdd`, `dateUpd`,
   `customerId`, `deliveryAddressId`, `totalPaidTaxIncl`, `rows[]{orderDetailId, productReference, quantity,
   unitPriceTaxExcl}`, `firstName/lastName`, `countryId`, `isoCode`, `mobilePhone`, `orderCarrierId`, `trackingNumber`,
   order history `{orderId, orderStateId}`.
8. Product write body: native types, `localizedNames/Descriptions/ShortDescriptions/MetaTitles/MetaDescriptions/
   LinkRewrites` as `{langId: value}`, `taxRulesGroupId`, `defaultCategoryId`, `categoryIds`, `active` boolean,
   `ean13` only when present.
9. Images: `GET/POST /products/{id}/images`, `DELETE /products/{id}/images/{imageId}`; POST body `{ url }`
   (the server fetches the image from our storage; no multipart); list items carry `imageId`.
10. A 401 invalidates the cached token and the request is retried once.

## Webservice
11. Base path `/api`, Basic auth with the key as username and empty password, `output_format=JSON`, `display=full`.
12. JSON is accepted on write as well as read (real PS historically wants XML on writes; to verify). Write bodies are
    wrapped `{ product: {...} }`; single reads are unwrapped from the singular key.
13. List reply `{ <plural>: [...] }`; an EMPTY collection is returned as `[]` (known PS quirk) and is handled.
14. `PUT` replaces the whole resource, so the connector does GET, merge, PUT.
15. Filters: `filter[field]=[v]`, multi-value `[a|b]`, date range `filter[date_upd]=[from,2999-12-31 23:59:59]&date=1`,
    `sort=[date_upd_ASC]`, `limit=offset,count`.
16. Field names are snake_case as in the classic API (`id_tax_rules_group`, `id_category_default`, `current_state`,
    `associations.order_rows`, `product_reference`, `id_country`, `phone_mobile`, ...). Booleans and numbers are strings.
    Localized fields are `[{id: langId, value}]`. Images: `GET/POST /api/images/products/{id}`,
    `DELETE /api/images/products/{id}/{imageId}`, list `{ image: [{id}] }`, POST body `{ url }` (assumed, real API is
    multipart).
17. Stock: one `stock_availables` row per product with `id_product_attribute = 0` (no combinations); quantity is set
    absolute, clamped to >= 0. Missing row = per-item failure.

## Semantics
18. Dates are `YYYY-MM-DD HH:MM:SS`, treated as UTC (real shop timezone offset not modelled).
19. Order `currency` comes from `settings.currency` (default EUR), not the order's `id_currency`.
20. Orders are polled by `date_upd >= since` ascending, filtered to `settings.paidStateIds` server side and again
    client side; duplicate ids in a page are dropped (idempotent). Paging by `cursor.page/perPage` (default 50); a full
    page yields a next cursor. Customer, address and country are fetched per order (cached within one call).
21. Customer phone = delivery address phone (or mobile); shipping address email = customer email.
22. `knownSkus(skus)` returns the SKUs present in the PIM; orders with other SKUs get
    `manualReview: { reason: 'unknown_sku', unknownSkus }` (contract field added, optional). Without the callback nothing is flagged.
23. `pushShipment`: updates the LAST order_carrier row of the order with the tracking number (carrierCode is not
    mapped to a PS carrier id), then creates an order history to `shippedStateId` unless already in that state.
24. Upsert match order: explicit `externalId`, else `reference = sku`, else `ean13`. Weight g/1000 with 3 decimals.
    Price is sent tax excluded as given; VAT comes only from `taxRulesGroupId`. Product `attributes` and
    `compliance` are not sent. `link_rewrite` is a slug of the title.
25. Payload hash = SHA-256 of `canonicalJson` (core-domain) of the routed-shape product body + sorted image checksums
    + clamped stock. Caller persists `payloadHash` / `imageChecksums` and passes them back as
    `lastPayloadHash` / `lastImageChecksums` (optional contract fields added). Image checksums default to the URLs.
    When the image set changed, all existing images are deleted and all are re-added.
26. `testConnection` lists shops (limit 1): 401/403 or a token 4xx -> `invalid_credentials`; network/timeout ->
    `unreachable`; anything else `unknown`.
27. Secrets: token request failures are rethrown as `TokenRequestError` with the status only; the HTTP client
    redacts URLs, headers and bodies; covered by a leak test.
