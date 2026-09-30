# AW/Aiku fixture assumptions

The companion doc `fornecedores/aw-dropship-api.md` was unavailable, so every response shape below is
invented or inferred from the PRD (section 6.1, 12.2) and lives only in
`packages/connector-aw-aiku/src/__fixtures__/*.json`. Replace the fixtures with recorded real responses
(same file names or new files with the same prefix: the contract spec replays every `products-*`,
`my-products.*`, `transactions*` and `images*` file) and fix the mappers where they disagree.

Facts taken from the PRD: AAL-07 (cost "0.94", stock 267, weight 19, EUR), portfolio store id 3761386,
"Portfolio has been deleted.", Laravel envelopes (`data`, `links.next`, `meta.current_page/last_page`),
endpoint paths and field names in FR-AW-003..007.

## Assumed (unverified)
1. AAL-07 product: id 1201, slug, ean, names "Crystals/Wands/Selenite", descriptions, image URLs.
   Relations are nested objects `department.name` (flat `*_name` accepted too).
2. `GET /user-profile` returns `{data:{name, currency_code, balance}}`.
3. `my-products` items: `id`, `item_id`, `code`, `quantity_left`, `weight`, `price`, `selling_price`; a disabled
   entry is marked by `state`/`status` = "disabled". Store response is `{data:{id,item_id,code}}`.
4. Delete: 2xx with a `message`; a message containing "disabled" means disabled instead of deleted.
5. Images: `{data:[{uuid,name,mime_type,source:{original},thumbnail:{...}}]}`; entries without `source.original` are dropped.
6. Clients: search returns `{data:[{id,email,status:"active",address:{address_line_1,address_line_2,postal_code,locality,country_code}}]}`;
   create takes `{company_name,contact_name,email,phone,address:{...same keys}}` and returns `{data:{id}}`.
   Address checksum = sha256 of lower-cased, whitespace-normalised line1/line2/postal/city/country.
7. Order store, transaction store, update, submit return `{data:{id,...}}` (only `data.id` of order store is read).
8. `GET /dropshipping/order/{id}` returns `{data:{id,state,item_quantity,total_amount}}`; optional
   `tracking_number` and `carrier`/`carrier_name` are mapped defensively (S0.1 unresolved, `trackingRead` capability false).
9. `GET /dropshipping/order/{id}/transactions` returns `{data:[{id,quantity_ordered,quantity_dispatched,quantity_fail,quantity_cancelled}]}`.
10. `total_amount` must be strictly below `maxSupplierCost` (PRD: "below"); equality aborts.
11. Money is normalised to canonical decimal strings ("12.40" becomes "12.4").
12. Saga retries each step `maxSagaRetries` (default 3) times on top of HTTP retries, then returns state `failed`
    (never deleting the AW order). `SupplierOrderResult.error` (optional, added to connector-contracts) carries the redacted message.
