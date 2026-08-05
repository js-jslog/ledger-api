# Ledger API

A REST API for a retail bank: users, accounts and transactions.

This README is written properly once the service exists. What follows is the part that
is needed now, because getting the database wrong is expensive to diagnose later.

## Running the service

```
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Then `curl localhost:3000/health`, which answers `{"status":"ok"}`. `PORT` overrides the
port.

Nothing but Node and pnpm is required for this path — the devcontainer in
`.devcontainer/` is one way to get a working toolchain, never a requirement. The database
below is separate, and the service does not need it yet.

`pnpm build` compiles to `dist/` rather than the service being run straight from source.
Node executes TypeScript directly, but it does not rewrite import specifiers: this
codebase imports `./app.js` as `nodenext` requires, and native execution then looks for a
file that only the compiler produces. A build step is one way to resolve that and a
TypeScript-aware runner such as `tsx` is another; the build step is preferred here because
it adds no dependency and refuses to start code that does not typecheck.

## Running the database

```
docker compose up -d --wait
```

`--wait` returns when Postgres is accepting connections rather than when the container
is running, which is what stops the first query of a fresh run losing a race.

Two databases are created: `ledger` for development, and `ledger_test` for the test
suite. Nothing needs configuring — the working connection strings are defaults in
`src/db/connection.ts`, overridable with `DATABASE_URL` and `TEST_DATABASE_URL`.

```
pnpm test
```

The suite drops and recreates the `public` schema in `ledger_test` before migrating, so
a run does not depend on what the previous one left behind. It refuses to do that to any
database whose name does not end in `_test`.

## Troubleshooting

**A migration fails with `relation "..." already exists`, or the database holds tables
this codebase never creates.** The data directory has outlived the container. Stopping
and starting does not clear it, and neither does `docker compose down` — the volume is
deliberately persistent, and only `-v` removes it:

```
docker compose down -v && docker compose up -d --wait
```

That is also the command to run after changing anything in `initdb/`, which the image
reads only when initialising an empty data directory.
