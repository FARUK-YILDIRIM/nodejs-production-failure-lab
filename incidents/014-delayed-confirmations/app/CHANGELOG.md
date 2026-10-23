# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

## 2.27.0 — 2026-12-21

- feat(notifications): confirmation emails are sent by a new worker, from the `order-events` topic, instead of in the background of the API: when MailWave is down, they wait in the topic instead of being lost (#738)

## 2.26.1 — 2026-12-18

- fix(ops): `/ready` only checks the database; dependencies are reported at `/health/dependencies`; postmortem of the intermittent 503s (#734)

## 2.26.0 — 2026-12-17

- feat(ops): `/ready` checks every dependency (database, TaxRate, PayFlow, Recommendations, MailWave): the proxy only sends requests to instances that can reach all of them (#731)

## 2.25.2 — 2026-12-16

- fix(server): on SIGTERM, fail `/ready` and keep serving for 5 s before closing; postmortem of the errors on every deploy (#728)

## 2.25.1 — 2026-12-15

- fix(checkout): one retry at most for TaxRate quotes, with jitter, within a retry budget; postmortem of the December 14 checkout outage (#721)

## 2.25.0 — 2026-12-11

- feat(checkout): retry TaxRate quotes, so that a blip at TaxRate doesn't fail a checkout (#716)

## 2.24.3 — 2026-12-10

- fix(checkout): placing an order is idempotent: every attempt of a checkout with the same Idempotency-Key gets the same order and the same card authorization; postmortem of the December 9–10 duplicate orders (#711)

## 2.24.2 — 2026-12-08

- chore(deps): bump `pg`, `express` and the OpenTelemetry packages (#703)

## 2.24.1 — 2026-12-05

- fix(catalog): product pages wait at most 250 ms for Recommendations, then show products from the same category; postmortem of the December 4 product page outage (#699)

## 2.24.0 — 2026-12-01

- feat(catalog): product pages show "Customers also bought" from the data team's Recommendations service, instead of more products from the same category (#694)

## 2.23.1 — 2026-11-27

- fix(checkout): authorize the card before locking anything, and take stock with a conditional update in a short transaction; postmortem of the Black Friday checkout timeouts (#683)

## 2.23.0 — 2026-11-18

- feat(checkout): card payments with PayFlow; the card is authorized when the order is placed, and a declined card is refused with 402 (#668)
- feat(catalog): stock levels; checkout reserves the stock it sells, so a product can't be oversold, and refuses sold-out products with 409 (#671)

## 2.22.1 — 2026-10-21

- fix(checkout): every checkout path ends its transaction and returns its connection; the pool times out after 5 s again; postmortem of the October 19 hanging requests (#659)

## 2.22.0 — 2026-10-19

- feat(checkout): coupon codes; a coupon is locked while its order is written, so limited coupons can't be over-redeemed (#655)

## 2.21.2 — 2026-10-16

- fix(db): don't fail checkouts with "timeout exceeded when trying to connect" when the pool is busy for more than 5 s; wait for a connection instead (#649)

## 2.21.1 — 2026-10-08

- fix(account): order history fetches all items in one query; postmortem of the October 6 slow order history (#644)

## 2.21.0 — 2026-10-05

- feat(account): order history includes each order's items, with product image and category, for the new "My orders" screen of the mobile app (#640)

## 2.20.2 — 2026-09-29

- chore(deps): bump `pg` and `express` (#631)

## 2.20.1 — 2026-09-15

- fix(catalog): index order items by product for the purchase counter; postmortem of the September 15 database overload (#615)

## 2.20.0 — 2026-09-14

- feat(catalog): product pages show how many units were bought ("Bought 83 times"), to build trust on product pages (#612)

## 2.19.2 — 2026-09-10

- chore(db): schema changes ship as SQL migrations in `src/migrations`, applied at startup (#607)

## 2.19.1 — 2026-09-09

- fix(checkout): tax quotes go through the shared, pooled HTTP client; postmortem of the September 8 slow checkouts (#605)

## 2.19.0 — 2026-09-08

- feat(checkout): sales tax / VAT on every order, quoted by TaxRate; orders store `tax_cents` (#601)

## 2.18.3 — 2026-09-04

- perf: gzip-compress JSON responses (#590)

## 2.18.2 — 2026-08-26

- fix(orders): background confirmations handle their own failures and retry transient errors; postmortem of the August 25 error bursts (#588)

## 2.18.0 — 2026-08-24

- feat(orders): order confirmation emails through MailWave, sent in the background (#577)

## 2.17.2 — 2026-07-22

- fix(catalog): bounded catalog cache keyed by meaningful parameters only; postmortem of the July 22 restarts (#533)

## 2.15.2 — 2026-06-30

- perf(reports): build the sales export in SQL and reuse number formatters; postmortem of the June 30 latency incident (#488)
