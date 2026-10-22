# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

## 2.17.1 — 2026-07-21

- fix(orders): return 404 instead of 500 for unknown customers on order history (#530)

## 2.17.0 — 2026-07-20

- perf(catalog): cache catalog responses in memory for 60 s; the catalog changes a few times a day and product listings are our most frequent queries (#521)

## 2.16.1 — 2026-07-14

- chore(deps): bump `express` to 5.3 and `pino` to 10.4 (#517)

## 2.16.0 — 2026-07-08

- feat(catalog): product cards show the image gallery and the product description (#509)

## 2.15.2 — 2026-06-30

- perf(reports): build the sales export in SQL and reuse number formatters; postmortem of the June 30 latency incident (#488)

## 2.15.1 — 2026-06-30

- fix(orders): reject orders with more than 10 line items (#482)

## 2.15.0 — 2026-06-29

- feat(reports): the sales export now includes SKU, product name, category and formatted prices (#471)

## 2.14.3 — 2026-06-29

- chore(deps): bump `pg` to 8.23 (#476)

## 2.14.0 — 2026-06-15

- feat(reports): CSV sales export for Finance (#440)
