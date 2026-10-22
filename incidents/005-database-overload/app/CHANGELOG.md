# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

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
