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

## Authentication

`POST /v1/auth/login` exchanges an email and password for a bearer token, which every
endpoint except that one and `POST /v1/users` requires in an `Authorization: Bearer …`
header.

**Tokens do not survive a restart, and that is a deliberate limitation rather than a bug.**
The signing key is generated once per process and is the one configurable-looking value
with no environment variable, no default and no committed fallback — so a fresh clone runs
with nothing configured and there is no key in this repository to leak. The cost is that
restarting the service invalidates every token it has issued. `docs/residual-risk-catalogue.md`
R32 carries the reasoning, and R38 records what a deployed service would need instead.

## Adding an endpoint

This service is expected to grow, and adding an endpoint should require no new machinery.
That is a claim rather than a hope, so here is the whole of it. Every step names the file
it happens in, and there is no step that is not on this list.

**0. Only if the resource is new: a migration and an identifier.**
`migrations/00N-<table>.ts` with its Kysely declaration in `src/db/schema.ts`, and a minter
in `src/domain/ids.ts` if the resource carries a new kind of id. Each table arrives with
the endpoint that first reads it rather than up front, because the migrations are where the
money representation and the trigger-maintained timestamps are actually settled, and those
are domain decisions rather than plumbing. Most endpoints skip this step; it is numbered
zero because when it does apply it comes before everything else.

**0b. Only if the domain cannot yet do what the endpoint needs: a domain function**, in
`src/domain/`, with its tests. This is the step that is easy to miss, because the other
seven are about wiring and this one is not.

The test is whether the endpoint is the first to *do* something rather than the first to
*expose* something. `GET /v1/accounts/{accountNumber}` was the first endpoint to render
money, and `toDecimal` did not exist — money had only ever travelled inwards. That is a
domain gap the endpoint revealed, not a step in wiring it up, and it belongs here where the
rest of `src/domain/` can see it rather than inside a service that happened to need it
first.

**1. An ingress schema, in `src/http/schemas.ts`** — one per thing the client sends. A
request body is one; so is a path parameter, which is client input like any other and is
validated as `req.params` rather than trusted because Express handed it over as a string.
`additionalProperties: false` on every object, **including nested ones** — it is not
inherited. `as const` is not optional: without it the inferred body type degrades to
`unknown` silently.

An endpoint with no body and no path parameter — `GET /v1/accounts` — skips this step.

**2. A response schema, in `src/http/response-schemas.ts`.** The published body, with
`additionalProperties: false`. This is not symmetry with step 1: it is what stops a
persistence row or a password hash reaching a client, because the adapter validates every
response against it and a leak becomes a 500 instead of a disclosure.

**3. A repository method, in `src/repo/<table>.ts`.** Add it to the port type first — the
service depends on that type and never on Kysely, so column names and driver error codes
stop here. A row that is not there comes back as `undefined` rather than as an error: the
repository reports what it found, and which status that deserves is step 4's decision.

**4. A service method, in `src/service/<resource>.ts`,** returning
`ResultAsync<Body, DomainError>`. This is where ownership is decided, and the order is
load-bearing:

> Resolve the resource. If it is not there, `notFound`. Only then compare its owner
> against the authenticated user id, and if they differ, `forbidden`.

Comparing first and resolving second answers 403 for a resource that does not exist, where
the specification says 404 — and it passes every happy-path test. `fetch_userRzA` in
`src/service/users.ts` is the worked instance.

**5. A handler, in `src/http/<resource>.ts`.** Two lines of shape: validate the ingress,
call the service, map the value to `{ status, body }`. Register it with **`authedHandler`**
unless the endpoint is one a caller reaches before it has a token — there are two of those
and there will not be a third. The adapter hands the authenticated user id in as the first
parameter, so a handler cannot ask who is calling and get no answer.

**6. One line in `src/http/app.ts`,** the composition root. Every route this service
answers is registered there, one line each.

**7. Tests, in `src/http/<resource>.test.ts`** — the happy path and at least one sad path.
Nothing generates them and nothing checks that they exist.

### What you do not touch

No middleware, no error-handling code, no registry and no configuration. A new error
status is the one exception, and it announces itself: the two tables keyed on the error
union — `LEVELS` in `src/domain/errors.ts` and `STATUSES` in `src/http/render-error.ts` —
fail to compile until the new kind has a level and a status.

`src/http/app.test.ts` drives every registered route with no `Authorization` header and
requires a 401, so an endpoint registered with the wrong adapter fails there rather than in
production. If your endpoint is genuinely public, that file is where you say so.

### The worked example: `GET /v1/accounts`

`GET /v1/accounts` is specified in `openapi.yaml` and deliberately not built —
`docs/residual-risk-catalogue.md` R34 records why. It is also the cheapest endpoint in the
document to add, which is what makes it the example: it introduces no concept the service
does not already have.

It skips step 1 entirely — no body, no path parameter. Its response schema is a wrapper
around the one `GET /v1/accounts/{accountNumber}` already uses. Its repository method is a
`where('user_id', '=', …)` returning an array. Its service method needs no ownership check
at all, because it never resolves a resource by an id the client supplied — filtering by
the authenticated user id is the whole of the authorisation, and that is the one case where
step 4's rule does not apply.

That leaves a response schema, a repository method, a service method, a handler, a route
and its tests.

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
