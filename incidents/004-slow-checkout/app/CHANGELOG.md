# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

## 2.19.0 — 2026-09-08

- feat(checkout): sales tax / VAT on every order, quoted by TaxRate; orders now store `tax_cents` (#601)

## 2.18.3 — 2026-09-04

- perf: gzip-compress JSON responses; product listings are 13 KB uncompressed (#590)

## 2.18.2 — 2026-08-26

- fix(orders): background confirmations handle their own failures and retry transient errors; postmortem of the August 25 error bursts (#588)

## 2.18.1 — 2026-08-25

- chore(deps): bump OpenTelemetry packages; trace outbound `fetch` calls (#584)

## 2.18.0 — 2026-08-24

- feat(orders): order confirmation emails through MailWave, sent in the background (#577)

## 2.17.2 — 2026-07-22

- fix(catalog): bounded catalog cache keyed by meaningful parameters only; postmortem of the July 22 restarts (#533)

## 2.17.0 — 2026-07-20

- perf(catalog): cache catalog responses in memory for 60 s (#521)

## 2.16.0 — 2026-07-08

- feat(catalog): product cards show the image gallery and the product description (#509)

## 2.15.2 — 2026-06-30

- perf(reports): build the sales export in SQL and reuse number formatters; postmortem of the June 30 latency incident (#488)
