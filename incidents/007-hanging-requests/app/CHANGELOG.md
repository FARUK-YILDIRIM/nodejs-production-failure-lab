# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

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
