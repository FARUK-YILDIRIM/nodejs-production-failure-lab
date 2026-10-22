# Contributing

Thanks for helping! The most valuable contributions are **new incidents**, **better evidence** in existing ones (a missing panel, a clearer hint), and **reports of incidents that don't reproduce** on your machine.

## Setup

```bash
npm install          # TypeScript and types for the CLI
npm run typecheck    # the CLI, the functional checks and every incident's service
```

The CLI runs straight from `cli/src` (Node.js 22.18+ runs TypeScript natively). The services run in Docker on Node.js 24.

## Proposing an incident

Open an issue first with the design from [docs/authoring-incidents.md](docs/authoring-incidents.md#1-design-it-on-paper-first): the failure, victims vs. culprit, the evidence chain, the trigger and the fix. Then build it following the rest of that guide.

## Conventions

- Only erasable TypeScript (no `enum`, `namespace` or constructor parameter properties): Node strips types, it doesn't compile them.
- Keep spoilers out of `incidents/`: no hints in names, comments or commit messages that land in the incident folder.
- Numbers in docs come from `./lab verify` runs; say what hardware they were measured on.
