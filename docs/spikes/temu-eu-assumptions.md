# Temu EU connector: assumptions (spike S0.8 unresolved)

Nothing below comes from Temu documentation. Every item must be confirmed or replaced in S0.8 / S0.9.
Code isolation points: `signing.ts` (Signer), `temu-api.ts` (methods, envelope, payloads, error codes), `carriers.ts` (table), `listing-validator.ts` (compliance list).

## Signing (FR-TEMU-001)
- A1. Algorithm: sort params by key, drop `sign` and null/undefined values, concatenate `key+value` (objects as JSON.stringify), wrap with app secret on both sides, hash, uppercase hex. MD5 default, SHA-256 selectable (`PlaceholderSigner`).
- A2. Signed params: all body fields including `type`, `app_key`, `access_token`, `timestamp` (epoch seconds, string), `data_type=JSON`, `version=V1`.
- A3. The test vectors in `signing.spec.ts` are PLACEHOLDER vectors computed from A1. Replace them with the official Temu vectors; swap the `Signer` implementation if the algorithm differs.

## Transport / envelope
- A4. Gateway host is configuration (`gatewayHost`); single endpoint `POST {host}/openapi/router`, method name in body field `type`.
- A5. Response envelope `{ success, errorCode?, errorMsg?, result? }`.
- A6. Error codes: 3000002 expired token, 3000003 revoked token (-> `reauthorization_required`); 3000001 bad app key, 7000001 bad signature (-> `invalid_credentials`). HTTP 401/403 also -> `reauthorization_required`; network/timeout/5xx -> `unreachable`.
- A7. Credentials travel in the body (not the URL). Logs carry only the redacted URL; API error messages are scrubbed of the secret, token and app key. Stored-at-rest helpers: `encryptCredentials` / `decryptCredentials`.
- A8. Rate limit: none by default (`requestsPerSecond` optional) until S0.8 states it.

## Methods and payloads (all placeholders, see `TEMU_METHODS`)
- A9. Names: `bg.mall.info.get`, `bg.goods.cats.get`, `bg.goods.attrs.get`, `bg.goods.add`, `bg.goods.update`, `bg.goods.offline`, `bg.goods.review.status.get`, `bg.goods.stock.update`, `bg.goods.price.update`, `bg.goods.price.review.get`, `bg.order.list.get`, `bg.order.shippinginfo.get`, `bg.order.shipment.confirm`.
- A10. Shapes of the requests/responses are as used in `temu-api.ts` and `connector.spec.ts` (goods body, `items[]` batch results with `success`/`pendingReview`, `reviews[]`, `orders[]`, shipping info fields).
- A11. Order list filter: `statuses=[AWAITING_SHIPMENT, CANCELLED, DELIVERED]` (the connector also drops any other status client side; cancelled/delivered orders are returned without decrypting shipping info, so they carry no PII),  `updatedSince` epoch seconds, `pageNo`/`pageSize` (default 20). Timestamps are epoch seconds. Ship-by deadline field `latestShipTime`, optional.
- A12. Shipping address comes from a separate decrypt call per order (dedicated scope); customer contact = address contact.
- A13. Order `totalAmount` is treated as NET of VAT when computing `maxSupplierCost`. If Temu reports gross, convert before calling `buildOrderImport`.

## Listing (FR-TEMU-002)
- A14. Mandatory attributes come from the category attribute call (`required`). Minimum images 3 (configurable `validation.minImages`).
- A15. Compliance fields (S0.9 placeholder): `gpsr_manufacturer`, `gpsr_eu_responsible_person`, `safety_information`; plus `clp_label` when `compliance.clpApplicable === true`. Configurable via `validation.requiredComplianceFields`.
- A16. Approved enrichment is conveyed by the optional `ChannelListingPayload.enrichmentApproved` (field added to connector-contracts). Anything other than `true` blocks the submit.
- A17. A blocked submit returns `{ status: 'inactive', skipped: true, reason: 'code:field; ...' }` and performs no add/update call.
- A18. Review statuses: PENDING_REVIEW/UNDER_REVIEW -> submitted; APPROVED/ONLINE -> live; REJECTED/REVIEW_FAILED -> rejected (reason kept, placeholder text if absent). Unknown status stays `submitted` with a reason noting it (never promoted to live).
- A19. Price change under review is signalled by `pendingReview: true` on the item; status later via `bg.goods.price.review.get` (APPROVED/REJECTED/other = still pending). While pending, new prices for that listing are skipped (`BatchItemResult.skipped`, field added to connector-contracts). The default tracker is in-memory; the runtime injects `PrismaPendingPriceStore` (table `channel_pending_price`), and the review poll job calls `pollPendingPrices` (a rejected price clears `lastPrice` so the next sync re-sends or blocks it, and raises `price_blocked`).

## Stock (FR-TEMU-003)
- A20. Sends `available` as given by the caller (FR-STK-001 computes it), floored to a non-negative integer.

## Orders and privacy (FR-TEMU-004)
- A21. PII (customer + address) is encrypted with core-domain AES-256-GCM via `encryptOrderForStorage`; persistence code must store only `StoredOrder`. `listOrdersSince` returns plaintext in memory only (the IChannelConnector contract).
- A22. Retention: purge when `now >= deliveredAt + 90 days` (`shouldPurgePii`); the delivery date is the time the order poll first sees status `DELIVERED` (Temu exposes no delivery timestamp in our assumed payload), stored by `ShipmentService.markDelivered`.
- A23. Ship-by alert: `shipByAlertDecision` alerts when no tracking and `<= 12 h` remain (also when overdue, flagged `overdue`); the caller records `alreadyAlerted`.
- A24. `maxSupplierCost = net * (1 - minMargin) - shippingAbsorbed - channelFee`, floored at 0, rounded DOWN to 2 decimals. Margin is a fraction (same as core-domain margin guard).
- A25. Idempotency key `temu-eu:{orderSn}`; only `AWAITING_SHIPMENT` orders are imported (`CANCELLED` / `DELIVERED` are tracked for known orders only); line SKU maps to `externalPortfolioId` (assumes our SKU equals the supplier assortment reference; to be confirmed with FR-AW-006).
- A26. Channel code for the dropship command: `TEMU`.

## Shipment (FR-TEMU-005)
- A27. No carrier ids are invented: the carrier table is required configuration (lower-case our code -> Temu id + name). Lookup is case-insensitive and trimmed; unknown codes throw `UnknownCarrierError` (`UNKNOWN_CARRIER`) before any HTTP call. Empty tracking number is refused.

## Tooling note
- A28. `packages/connector-contracts/dist` was stale/missing for type-checking; `pnpm build` in that package was run once (dist is gitignored).
