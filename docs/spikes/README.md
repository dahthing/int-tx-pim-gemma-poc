# Spikes (Phase 0)

The PRD (section 3) lists eleven blocking questions, S0.1 to S0.11. None of them has been answered with real data yet:
the AW companion doc and the PrestaShop and Temu documentation were not available, so each connector was built on
explicit assumptions and pinned by invented fixtures. The assumption notes below are the current "spike output"; they
are replaced by real notes plus recorded fixtures as each spike closes.

Status of every spike, what blocks it and who to ask: [../open-questions.md](../open-questions.md).

## Assumption notes

| Note                                                     | System                              | Code it isolates                                                                                        | Spikes it covers |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| [aw-aiku-assumptions.md](aw-aiku-assumptions.md)         | AW Dropship / Aiku API              | `packages/connector-aw-aiku/src/aw-mappers.ts`, `aw-aiku.connector.ts`, fixtures in `src/__fixtures__/` | S0.1 to S0.7     |
| [prestashop9-assumptions.md](prestashop9-assumptions.md) | PrestaShop 9 Admin API + Webservice | `packages/connector-prestashop9/src/endpoints.ts`, `mapper.ts`, fixtures in `src/__fixtures__/`         | S0.10, S0.11     |
| [temu-eu-assumptions.md](temu-eu-assumptions.md)         | Temu EU Partner Platform            | `packages/connector-temu-eu/src/signing.ts`, `temu-api.ts`, `carriers.ts`, `listing-validator.ts`       | S0.8, S0.9       |

## Index

| ID    | Topic                                                | Status | Assumption note                                                 |
| ----- | ---------------------------------------------------- | ------ | --------------------------------------------------------------- |
| S0.1  | Tracking number and carrier from AW                  | OPEN   | [aw-aiku](aw-aiku-assumptions.md) item 8                        |
| S0.2  | `country_code` without `country_id` on client create | OPEN   | [aw-aiku](aw-aiku-assumptions.md) item 6                        |
| S0.3  | How an AW order is paid on submit                    | OPEN   | [aw-aiku](aw-aiku-assumptions.md) item 7                        |
| S0.4  | Is AW `price` net of VAT, currency                   | OPEN   | [aw-aiku](aw-aiku-assumptions.md) items 1, 11                   |
| S0.5  | AW rate limits, `per_page=150`                       | OPEN   | [aw-aiku](aw-aiku-assumptions.md) (pagination in the connector) |
| S0.6  | Portfolio data feed columns                          | OPEN   | [aw-aiku](aw-aiku-assumptions.md) item 3                        |
| S0.7  | Shipping cost per country and weight                 | OPEN   | none yet (flat `shippingAbsorbed` setting)                      |
| S0.8  | Temu Partner Platform API, signing, scopes           | OPEN   | [temu-eu](temu-eu-assumptions.md) A1 to A13, A27                |
| S0.9  | Temu EU compliance fields per product                | OPEN   | [temu-eu](temu-eu-assumptions.md) A14 to A16                    |
| S0.10 | PrestaShop 9 Admin API coverage                      | OPEN   | [prestashop9](prestashop9-assumptions.md) items 1 to 27         |
| S0.11 | Mapping gemmams.pt products to AW                    | OPEN   | [prestashop9](prestashop9-assumptions.md) items 22, 24          |

## Closing a spike

1. Write `docs/spikes/s0.N-<topic>.md`: question, how it was tested, answer, date, who confirmed it.
2. Record the real (anonymised) responses as fixtures next to the connector and replace the invented ones; the
   contract specs replay every recorded file, so a mapper that disagrees fails CI.
3. Fix the isolated code listed in the table above, remove the corresponding item from the assumption note.
4. Change the status in `docs/open-questions.md` and in the table above.
