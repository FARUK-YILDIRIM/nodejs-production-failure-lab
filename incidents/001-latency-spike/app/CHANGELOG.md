# Changelog

All notable changes to `shopflow-api`. Deployed to production by the release pipeline after merge.

## 2.15.1 — 2026-06-30

- fix(orders): reject orders with more than 10 line items (#482)

## 2.15.0 — 2026-06-29

- feat(reports): the sales export now includes SKU, product name, category and formatted prices — requested by Finance for the H1 close (#471)

## 2.14.3 — 2026-06-29

- chore(deps): bump `pg` to 8.23 (#476)

## 2.14.2 — 2026-06-26

- perf(catalog): composite index for category listings (#463)

## 2.14.1 — 2026-06-22

- fix(customers): order history sorted newest first (#455)

## 2.14.0 — 2026-06-15

- feat(reports): CSV sales export for Finance (#440)
