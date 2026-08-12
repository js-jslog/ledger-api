# Ledger API

## Approach

### The initial strategy

I have taken an engineering leadership approach to delivering this solution with the goal of
exercising the skills relevant to the Staff Engineer role. The focus has been on identifying goals,
formalising a plan, mitigating & recording risks, surfacing blocking problems early, decision-making
& course correction as the plan is executed, and delivering on the arranged day to the recruiting
agent.

I have chosen TypeScript for two reasons:

1. My own familiarity, which will result in more fluid demonstrations wherever code walkthroughs are
   required.
2. The opportunity to demonstrate that I solve problems which Java is more prepared for than TS, not
   because they are easy, but because they are important. These decisions are more visible using TS.

### The method itself

For the benefit of focused interrogation, if required. These are the key elements which I consider
myself accountable for, including parts I did not design when the process that produced them was
mine.

My first decision was that the approach should combine the agility of iterative design with the
reassurance of a material solution. A "probe" agent reported on deep issues which deserved proper
anticipation in a final design, and a brief was built around that domain knowledge and the
foundations I specified to keep the iterative solution focused, well architected and legible.

Beyond the original brief, control over the project took two forms. Early phases involved high
attention manual review, where no guardrails had been set yet and drift from the brief was likely.
That review covered every slice up to and including the first endpoint: the toolchain, the
validation funnel, the corrections to the supplied specification, the HTTP skeleton, the error
envelope, and the first endpoint, `POST /v1/users` which was the basis for the rest. A handful of
corrections were made which are named in R37 of the `docs/residual-risk-catalogue.md`:

> that review is where a material share of this repository's corrections came from - a mis-stated
> invariant, a mechanism that guarded less than its name implied, a test that asserted a route into
> existence, an over-built design for a service that is never deployed.

Once the foundations had been set, progress needed to accelerate to meet the deadline. Deep code
reviews were replaced with a strategic orientation on a trimmed deliverable set, per-slice checkins
with space for problems to be escalated for my review, extensibility as a stated goal with a
walkthrough positioned early enough to be tested and corrected by endpoint implementations.

This shift produced the Addenda sections in the `build-brief.md` and a record of accepted risk in
R37 as well as further additions to `docs/divergences.md`. These, as much as the endpoints, are the
deliverables of the project because they record that course correction occurred, whether under my
own guidance or due to the mechanisms and goals that I had set.

## Functional deliverable

A REST API for a retail bank: users, accounts and transactions. Express 5 and Postgres,
in TypeScript, against the specification in `openapi.yaml`.

Seven endpoints are delivered — create and fetch for each of users, accounts and
transactions, plus login. Two that the specification publishes are deliberately not
built: `GET /v1/accounts` and `GET /v1/accounts/{accountNumber}/transactions`. That gap
is explained rather than omitted — § Adding an endpoint below walks through building the
first of them as its worked example.

Three documents carry the reasoning behind the decisions this one describes:

- **`docs/residual-risk-catalogue.md`** — every limitation that was chosen rather than
  encountered, each with what it costs, the sequence that triggers it, and what closes
  it. The doctrine of this build made visible, and the first thing to read.
- **`docs/spec-changes.md`** — every edit made to the supplied specification, by
  category, including the findings that were read and deliberately not acted on.
- **`docs/divergences.md`** — where the build departed from its own design, slice by
  slice, and what measurement said when it did. A working document rather than a
  polished one, and it is where the negative results live.

`docs/conventions.md` states the standing rules the code is held to — naming, comments,
evidence, test hygiene and what a commit carries.

## Running the devcontainer

The development and demostration has been tested from the context of a devcontainer. To follow that
workflow there are only two prerequisites:

- Docker
- Devcontainer CLI

This process has only been run from Windows with Docker Desktop, but it is expected to work on a
linux or macOS (although you will have to make a counterpart to the runcontainer.ps1 file):

```
git clone https://github.com/js-jslog/ledger-api.git
cd ledger-api && ./runcontainer.ps1 start
```

## Demonstrating the endpoints

The integration tests are where all of the time has been spent in ensuring the health of the
endpoints. There is a full service to run which is expected to satisfy the spec also, but
all that is additionally covered by that is the build and entrypoint work correctly which is
really just a typescript config test.

Interrogating the code and the tests is also probably the most direct way to test understanding
of the solution.

For both of these reasons, these instructions preceed the service running instructions.

```
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm test
```

## Running the service

```
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Then `curl localhost:3000/health`, which answers `{"status":"ok"}`. `PORT` overrides the
port.

Nothing but Node and pnpm is required for this path — the devcontainer in
`.devcontainer/` is one way to get a working toolchain, never an intended requirement. The
`Dockerfile` at the repository root builds _that_ development image — an editor and shell
environment — rather than the service; there is no container image of this API, and the
three commands above are how it runs. The database below is separate: the service starts
and answers `/health` without it, and every endpoint that touches data needs it.

The commit gate is opt-in per clone and does not install itself. Anyone intending to
commit here wants:

```
git config core.hooksPath .githooks
```

which runs typecheck, lint and the full suite before each commit, and checks the message.
Without it nothing runs and nothing says so — `docs/residual-risk-catalogue.md` R27 has
the rest of that gap, including why the hooks are native rather than managed by a tool.

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

## Configuration

Four values are configurable, each read from the environment where it is used and each
with a committed default that works: `DATABASE_URL` and `TEST_DATABASE_URL` (the two
compose connection strings), `PORT` (3000) and `BCRYPT_COST` (12, which the test runner
sets to 4 because hashing at 12 would otherwise dominate the suite). There is no `.env`
and no `.env.example`, so a fresh clone needs nothing configured — `src/db/connection.ts`
explains why the working value is committed in code rather than in an example file that
could drift from it.

Two values look configurable and deliberately are not. **The JWT signing key** is
generated once per process, with no variable, no default and no committed fallback —
§ Authentication below, and R32. **`POOL_MAX`** in `src/db/connection.ts` bounds each
connection pool at five; that is a property of how this process talks to the database
rather than a dial an operator turns, and R12 carries both the measurement behind the
number and the reason the default of ten is wrong here.

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

The table is not always the resource. `POST .../transactions` writes a transaction row and
changes a balance, so it touches two, and the rule is that whatever must happen together
lives in one method with the database transaction inside it — `record_transactionRzA` in
`src/repo/transactions.ts` opens the boundary and calls `debitIfSufficient` from
`src/repo/accounts.ts` within it. Note what is *not* on either port: the balance change
alone. A service that could reach it could move money and write no ledger row.

**4. A service method, in `src/service/<resource>.ts`,** returning
`ResultAsync<Body, DomainError>`. If the endpoint reaches a resource by an id the client
supplied, do not write the ownership check — call it:

```ts
repo
  .find_accountByNumberRzA(accountNumber)
  .andThen((account) =>
    owned_resourceRz(account, (found) => found.userId, authenticatedUserId, 'Bank account'),
  )
  .map(toResponse)
```

`owned_resourceRz` is in `src/service/ownership.ts`. It answers 404 for a resource that is
not there and 403 for one belonging to somebody else, in that order, and the order is the
reason it is a function rather than four lines you copy: comparing the owner before the
lookup answers 403 for a resource nobody holds — where the specification says 404 — and it
passes every happy-path test. The only thing your endpoint supplies is which field carries
the owner.

**5. A handler, in `src/http/<resource>.ts`.** Two lines of shape: validate the ingress,
call the service, map the value to `{ status, body }`. Register it with **`authedHandler`**
unless the endpoint is one a caller reaches before it has a token — there are two of those
and there will not be a third. The adapter hands the authenticated user id in as the first
parameter, so a handler cannot ask who is calling and get no answer.

**6. One line in `src/http/app.ts`,** the composition root. Every route this service
answers is registered there, one line each.

**7. Tests, in `src/http/<resource>.test.ts`** — the happy path and at least one sad path.
Nothing generates them and nothing checks that they exist.

Occasionally a decision the endpoint makes cannot be reached from outside. The withdrawal
answers 404 rather than 422 when the account row has gone between the ownership check and
the debit, and no request can produce that, because this service publishes nothing that
deletes an account. Deleting the branch left all of the tests passing. Where that happens,
the test belongs beside the code that makes the decision — `src/repo/accounts.test.ts` is
the only one in this project — rather than nowhere.

**8. Whatever the endpoint claims that nothing executes.** The seven steps above make it
work; this one keeps it honest, and it is the step most easily skipped because everything is
already green when you reach it.

Two files hold those claims. Every schema goes in `src/http/validator-for.type-assertions.ts`,
because a schema that lost its `as const` still validates at runtime and silently stops
carrying a type. A guarantee expressed in the Kysely declaration goes in
`src/db/schema.type-assertions.ts` — `transactions` is append-only because every column
declares `never` in the update position, and nothing at runtime would ever report that
being lost.

The test for whether something belongs here: if this property broke, what would fail? If the
answer is "nothing, until someone notices", it belongs in one of those two files.

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

## Dependencies

Nine runtime dependencies. Versions live in `package.json` rather than being repeated
here, where they would be a second copy free to go stale.

| Dependency | What it does | Why this one |
| --- | --- | --- |
| `express` | HTTP framework | Boring, and legible to a reviewer who does not write Node. Express 5 propagates errors out of `async` middleware natively, which is what the JWT 401 path relies on; under Express 4 that rejection goes unhandled. |
| `pg` | Postgres driver | What Kysely's Postgres dialect is built on. It also parses `INTEGER` as a native JavaScript number with no configuration, which is what lets the money representation be honest — `bigint` and `numeric` both come back as strings, and a Kysely declaration saying otherwise is a lie `strict: true` cannot catch. |
| `kysely` | Typed query builder | Not an ORM: the SQL stays visible and `SELECT … FOR UPDATE` is available rather than abstracted behind a session. Migrations come with it, so there is no second tool. Its table declarations in `src/db/schema.ts` are also where `transactions` is made append-only, by declaring `never` in the update position of every column. |
| `ajv` | JSON Schema validation | Runs at every ingress and against every response body. Configured `strict: true`, which *throws* on a regular expression left in a `format` keyword — that is what made six defects in the supplied specification findable rather than silent. See `docs/spec-changes.md`. |
| `ajv-formats` | The standard `format` keywords | Ajv 8 stopped shipping these deliberately; `email` and `date-time` are both used here. By Ajv's own authors, and needed the moment a schema names a standard format. |
| `json-schema-to-ts` | Compile-time type from the same schema | The schema that validates at runtime is also what produces the TypeScript type, so the shape has no second position in which to be stated and therefore no way to disagree with itself. The validation funnel rests entirely on this, and it is why `as const` is not optional — R19. |
| `neverthrow` | The `Result` type | Insufficient funds and a foreign account are expected outcomes, not exceptions. Combined with the handler adapter, handling every `Result` becomes a property the compiler checks at the boundary. The companion lint plugin was evaluated and declined **on dependency health rather than on style**; R17 names the gap that leaves and sizes the custom rule that would close it. |
| `bcryptjs` | Password hashing | Pure JavaScript, so a reviewer's install cannot fail on a node-gyp toolchain that is not there — which matters more under pnpm, where a native rebuild also has to clear the build-script gate. The cost is real and was measured rather than assumed: hashing is serialised on the event loop, which R10 puts at roughly twenty logins per second per process. |
| `jose` | JWT signing and verification | No native dependencies, actively maintained, and it does the one thing asked of it. What it is *not* asked to do is the token lifecycle — no refresh, no revocation, no rotation — which is the deliberate gap recorded as R38. |

### The toolchain, and the one version that is pinned

**TypeScript is pinned to the 6 line (`~6.0`)** rather than tracking the latest release,
and the pin is load-bearing twice over. typescript-eslint declares
`typescript >=4.8.4 <6.1.0` and hard-aborts at startup on 7, which would take the whole
type-aware lint ecosystem with it — including `no-floating-promises`, which this project
delegates to it rather than to a review checklist. And the schema type inference above is
sensitive to the compiler that produces it. R14 and R20 carry the two halves; the second
is the more interesting one.

The rest, briefly. **vitest** runs ESM TypeScript with supertest and Express 5 at zero
configuration. **supertest** drives the app in process, so every test goes through the
real HTTP stack without binding a port. **eslint** with **typescript-eslint** supplies the
type-aware rules, alongside one custom rule in `eslint-rules/` that enforces the `Rz`
naming convention. **pnpm** because its symlinked layout makes an undeclared transitive
dependency fail rather than resolve silently through flat hoisting — R18 records what that
costs a reviewer, and `pnpm-workspace.yaml` explains the one gate it puts in the way.

Why there is a build step at all — Node executes TypeScript but does not rewrite import
specifiers — is answered in § Running the service, where the command is.

## Design decisions

An index rather than a set of decision records, and that is a choice worth stating.
Every decision below was taken during the build, at the point it was forced, and its
reasoning was written down then — in the catalogue, in the slice notes, or beside the
code. Restating any of it here would create a second copy free to drift from the first,
which is the duplication this project avoids everywhere else. So the table says what was
decided and where the argument lives, and the pointers are meant to be followed.

| Decision | Where the reasoning lives |
| --- | --- |
| Money is integer pennies in an `INTEGER` column, never a decimal inside the service boundary | R9 carries the column choice and its £21.4m ceiling; `docs/divergences.md` § Slice 4/5, and the note below |
| `toPennies` is the only decimal→integer conversion and the only 2dp validator, with the Ajv `currencyScale` keyword complementing rather than duplicating it | `docs/divergences.md` § Slice 1 for the conversion, § Slice 0b for the keyword; R11 records the two-places cost |
| Validation is a single funnel: one schema object drives runtime validation and the compile-time type | `docs/divergences.md` § Slice 0b; R16, R19, R20 |
| Response bodies are validated against their published schema, so a leaked hash is a 500 rather than a disclosure | `docs/divergences.md` § Slice 2; R35 |
| Errors are values, with one renderer and two sources; the handler adapter makes every `Result` handled a compile-time property | `docs/divergences.md` § Slice 1; R13, R17 |
| The withdrawal is a conditional `UPDATE` inside an explicit transaction, and answers 404 rather than 422 when the row has gone | `docs/divergences.md` § Slice 6/7; R1, R15, and the note below |
| Ownership is resolved then authorised, in one shared function rather than a repeated pattern | `docs/divergences.md` § Slice 4/5; R7, R37 |
| Timestamps are maintained by a database trigger, and the Kysely type makes an application write a compile error | `docs/divergences.md` § Slice 2; R37's table records what the type pins |
| Account numbers are minted by insert-and-retry on `23505`, bounded, never check-then-insert | `docs/divergences.md` § Slice 4/5; R41 |
| The JWT signing key is generated per process and never configured | R32, and § Authentication above |
| The token has no lifecycle — the named gap in delivery scope | R38 |
| Two specified list endpoints are not built | R34, and § Adding an endpoint above |
| `PATCH` and `DELETE` are absent | R2, and R5 for what user deletion would need |
| TypeScript is pinned one major behind | R14, R20 |
| The connection pool is bounded at five rather than left at the driver default | R12, and the note below |
| Specification defects are corrected in the document rather than worked around in code | `docs/spec-changes.md` in full |

Three of those carry a detail that is worth having ready and does not live anywhere else,
so it is written here rather than left implied.

**`sum(integer)` returns a bigint, and therefore a string.** The column choice keeps
balances as native numbers, but that guarantee stops at aggregation: Postgres widens the
sum of an `INTEGER` column to `bigint` to avoid overflow, and node-postgres hands a
`bigint` back as a string. No query here aggregates, so nothing is wrong today — but the
first `SELECT sum(balance_pennies)` written against this schema will produce a string
where the declaration promises a number, and it will typecheck.

**The locking variant of the withdrawal was considered and not built.** `SELECT … FOR
UPDATE` on the account row before the debit closes the window in which a concurrently
deleted account turns a 404 into a 422. It is not built because that window needs a delete
endpoint to be reachable at all and none is published — R1 states the residual, and the
concurrency test in `src/http/transactions.test.ts` shows what the conditional `UPDATE`
does guarantee without it.

**The pool bound is five by measurement, not taste.** `pg` defaults to ten per pool and
every test file builds its own, which asks Postgres for far more simultaneous backends
than the suite can use. The concurrency test fires twenty withdrawals at a cold pool; under
the default that intermittently fails with `could not fork new process`, and the request
that could not get a connection answers 500 rather than the 422 the balance called for.
The money was right in every run — the failure was the suite reporting something other
than what it asserts.

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
