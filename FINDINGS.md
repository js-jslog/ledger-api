# Probe findings against build brief revision 3

An adversarial read of the brief, executed rather than argued. Each finding says
what the brief claims, what actually happens, and what the brief should say
instead. Findings are numbered `F<n>` and referenced from commit messages.

Severity is judged by one question only: **would this cost time or credibility
during the real 12-hour build or the pair-coding session?**

| | Finding | Severity |
|---|---|---|
| F1 | pnpm 11 build-script gate breaks the whole toolchain, not just install | **Blocker, step 0** |
| F2 | `pnpm add -D typescript` installs TS 7, which typescript-eslint refuses | **Blocker, step 0** |
| F3 | The devcontainer/compose risk in §10 is described backwards | Fixable — reclaims stop-line budget |
| F4 | vitest isolation needs two settings, and the second is not the obvious one | Moderate |
| F5 | §8 is sound and complete as far as it goes; two gaps in the assembly around it | Moderate |
| F6 | §4 forbids `multipleOf: 0.01` but names no replacement, and the obvious one is worse | **Gap — forced build item** |
| F7 | The Ajv + json-schema-to-ts + neverthrow seam blows up in its natural shape — **amended**, a working inferring shape does exist | **High — §14's predicted seam** |
| F8 | The linter advises a change that silently breaks the error handler | Moderate |
| F9 | A "fresh" compose Postgres silently inherits a stale volume, and the failure looks like a broken migration | **High — reviewer-visible** |
| F10 | §7's justification for the 422 is wrong; a zero-row update can mean 404 | **High — walkthrough risk** |
| F11 | Account-number minting is a forced build item with no decision recorded | **Gap — forced build item** |
| F12 | Nobody is assigned to maintain the timestamps the spec requires | Moderate |
| F13 | §6's "note, don't build" pile is not costless — the API can violate its own published schema | **High — reviewer-visible** |
| F14 | §4 accepts bcryptjs's "chunked on-thread hashing"; it barely chunks | Moderate |
| F15 | Two design moves make §3 invariants structural rather than checklist items | Opportunity |
| F16 | The validation funnel left the asserted type and the schema unbound — now closed | **Closed by the follow-up work** |
| F17 | Correlation ids and log-at-construction, and the three guards the intersection added | Addition |
| F18 | Nothing checked what the service sends back; egress validation catches a hash leak | **High — closes a §3 invariant** |
| F19 | F17's trust policy was wrong: the ingress payload was logging plaintext passwords | **Corrected — my error, not the brief's** |

**Suite time**, which §14 lists as unmeasured: **132 tests across 16 files in ~6s
wall clock**, including full Postgres integration and 20 end-to-end HTTP tests.
Roughly a third of that is bcrypt (F14). Serialised execution (F4) is not the
bottleneck at this size, so §4's isolation strategy costs nothing worth
optimising.

Confirmed as stated, no correction needed: all five §8 Express 5 acceptance
criteria; the `never`-based exhaustiveness check; and §14's "async middleware
error propagation" unknown, which resolves in the brief's favour.

---

## F1 — pnpm 11's build-script gate fails every script, and the documented fix is dead

**Brief:** silent on package management. §4 mentions `npm ci` only as a reason to
prefer `bcryptjs`.

**Observed.** `pnpm add -D vitest` pulls esbuild, whose postinstall is not
allowlisted. pnpm 11 then does not warn — it **fails every `pnpm <script>`
invocation**, because the pre-script dependency-status check shells out to
`pnpm install` and inherits its non-zero exit:

```
$ pnpm tsc --version
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1
pnpm: Command failed with exit code 1: ... pnpm.mjs install
    at runDepsStatusCheck (...)
```

`pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm tsc --version` all fail
identically. The presenting symptom is "my toolchain is completely broken",
which is a long way from the cause.

Two further traps in the fix:

1. The widely-documented `package.json` → `"pnpm": { "onlyBuiltDependencies" }`
   form **is no longer read at all** on pnpm 11. It fails silently; the only
   surfacing is `pnpm config list`, which prints
   `The "pnpm" field in package.json is no longer read by pnpm`.
2. pnpm 11 also renamed the key. `onlyBuiltDependencies` — pnpm 9/10, and what
   every tutorial and every model completion will suggest — is superseded by an
   `allowBuilds` **map** in `pnpm-workspace.yaml`. Setting the old key in the
   right file still leaves the build ignored.

The working form is `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }`.
Helpfully, pnpm writes a `esbuild: set this to true or false` stub into that file
itself, which is the fastest route to the answer if you notice it.

**Brief should say:** add to step 0, before anything else. This is a
20-to-40-minute sink inside a 90-minute stop line whose budget is meant for
Postgres, and it is not a Postgres problem, so the documented fallback in §11
would not rescue it. Note also that `--frozen-lockfile` reviewer instructions in
the README need `allowBuilds` committed or the reviewer hits the same wall.

## F2 — `pnpm add -D typescript` installs TS 7; typescript-eslint hard-refuses it

**Brief, §3:** "Mechanised instead, and therefore not on this list: `strict:
true`, and `@typescript-eslint/no-floating-promises` (requires type-aware
linting)." This is load-bearing — §5 moves the neverthrow invariant onto the
human checklist *because* the lint plugin was rejected, and §3 justifies not
hand-checking floating promises on the grounds that a linter does it.

**Observed.** A bare `pnpm add -D typescript` resolves to **7.0.2**. typescript-eslint
8.65 declares `typescript@">=4.8.4 <6.1.0"` and then refuses at runtime, not as a
warning but as a startup abort:

```
typescript-eslint does not support TS 7.0.
See also https://github.com/typescript-eslint/typescript-eslint/issues/10940
Error: typescript-eslint does not support TS 7.0.
```

So on a default install there is **no type-aware linting at all**, and the one
invariant §3 delegates to mechanisation has no owner. Nothing in the build would
announce this: the `lint` script exits non-zero from the very first run, which
in a session hunting for real lint errors reads as noise.

`pnpm add -D typescript@6` (6.0.3) restores it, verified:

```
src/floating.ts
  4:3  error  Promises must be awaited...  @typescript-eslint/no-floating-promises
```

**Brief should say:** pin `typescript` to the TS 6 line explicitly in §13
repository setup, and state the reason. TS 7 is the native-port compiler; opting
into it costs the entire typescript-eslint ecosystem for now. Also worth one
line in the ADRs — "why is this repo not on the current TypeScript" is exactly
the kind of thing a staff-level reviewer asks, and "because type-aware lint
rules are worth more to me than the new compiler" is a good answer.

Minor, same area: an `eslint.config.ts` file requires `jiti` installed or
ESLint 10 aborts. `eslint.config.mjs` avoids the dependency.

## F3 — §10's devcontainer/compose risk is described backwards

**Brief, §10:** "It did **not** verify compose inside a devcontainer, where
services are siblings in the inner daemon and resolve by service name rather
than published port — a different connection string — with a named-volume
workspace adding a further wrinkle. **[unverified]** This is precisely what the
stop line is for."

**Observed.** That describes *docker-outside-of-docker*, where the devcontainer
is itself a sibling container on the host daemon. This devcontainer specifies
the **docker-in-docker** feature, so the inner daemon runs as a process inside
the devcontainer and shares its network and mount namespaces. Consequences are
the opposite of the ones feared:

- Published ports land on the devcontainer's own loopback.
  `localhost:55432` connects. **The connection string is the ordinary one** and is
  identical to the reviewer's standalone path — no divergence to document.
- The compose service name is **not** resolvable from the devcontainer
  (`db: Name or service not known`), i.e. the string the brief predicts would be
  needed is the one that does not work.
- The named-volume workspace is a non-issue for the same reason. A bind mount of
  a workspace file into a compose service resolves correctly, verified by having
  Postgres run an initdb script off `/app` and reading back the table it created.
- `docker compose up -d --wait` reached healthy in **2.9s**.

**Brief should say:** the DinD/DooD distinction explicitly, and that under DinD
this risk is close to zero. Two residual risks replace it, both smaller:

- The inner daemon's image store is its own volume, so the first `compose up`
  after a devcontainer rebuild pays a full `postgres:17-alpine` pull (424MB).
  That, not name resolution, is the thing that could eat the stop line.
- DinD is what makes this work, so a future decision to drop it from
  `devcontainer.json` — the file already muses about exactly that — silently
  reintroduces every problem §10 describes.

The 90-minute stop line should stay, but F1 and F2 are the realistic ways to
hit it, not the database.

## F4 — vitest isolation takes two settings, and the load-bearing one is not `singleFork`

**Brief, §4:** "Test isolation | Truncate between tests, single worker | **vitest
4 defaults to parallel file execution** — this must be configured explicitly,
not assumed. **[unverified]**"

**Observed.** The default is confirmed parallel. Two files entering a shared
critical section, default config:

```
enter-B pid=251375     <- interleaved, two processes
enter-A pid=251374
exit-A  pid=251374
exit-B  pid=251375
```

The correction is that the obvious knob is not sufficient.
`poolOptions.forks.singleFork: true` **plus** `fileParallelism: false` serialises
the files but still reports **two different pids** — vitest's default
`isolate: true` forks a fresh process per file regardless. Adding
`isolate: false` collapses the run to a single pid.

That distinction is not cosmetic. It decides whether a module-level `pg.Pool`
and a shared truncate helper are actually shared or silently rebuilt per test
file. With `isolate: true` each file gets its own pool, so per-file setup cost
and total connection count scale with the number of test files.

**Brief should say:** `fileParallelism: false` **and** `isolate: false`, name
`isolate` as the one that matters, and record the cost — `isolate: false` leaks
module state between files, so anything cached at module scope becomes
deliberate. `singleFork` is not needed once `fileParallelism` is false.

## F5 — §8's five criteria all hold; two gaps sit just outside them

**Brief, §8:** lists five Express 5 specifics as `[verified]` and calls them
"acceptance criteria for step 1".

**Observed.** All five reproduce exactly as described (probe 02, 11 passing
tests). Nothing to correct. Three things to add.

**Closes a §14 unknown, favourably.** §14 lists "async middleware error
propagation" as unverified, and the JWT middleware's 401 path depends on it. A
rejected promise thrown from `async` *middleware* — not just an async route
handler — does reach the error middleware and render through the one renderer.
The brief can treat this as settled.

**Gap 1 — the four-parameter rule, and why TypeScript does not save you.**
Express decides a function is an error handler purely by `fn.length === 4`.
Write three parameters and it becomes ordinary middleware: the error skips it,
Express's default handler runs, and the stack-trace leak that criterion 3 exists
to close is silently reinstated. Verified — the three-argument handler's body
never executes and the response contains `at ` stack frames.

The interesting part is the TypeScript story, because the obvious assumption is
that `strict: true` covers this. It does not, quite. TS does not report "wrong
arity for an error handler"; it silently reinterprets `(err, req, res)` as
`(req, res, next)` and the only diagnostic is:

```
Property 'status' does not exist on type 'NextFunction'
```

That points at the body, never at the arity. You are protected, but by a
misleading error. Annotating the handler `ErrorRequestHandler` is what makes the
protection legible, so §8 should say so explicitly rather than leaving it to
chance.

**Gap 2 — `res.headersSent` needs a branch in the renderer path.** A handler
that writes a response and then throws sends the error to the middleware with the
response already committed. The one renderer's first act is `res.status(...)`,
which throws `Cannot set headers after they are sent`, from inside the error
handler — the one place with nothing above it to catch. §8's "one renderer"
design needs a guard ahead of it. One `if (res.headersSent) { res.end(); return }`
is enough, and it belongs in the criteria list as a sixth item.

**Minor:** the working path-to-regexp v8 spelling is `'/*splat'`, if a named
catch-all is ever wanted. Verified as not throwing, unlike `'*'`. The brief's
recommendation (a path-less `app.use`) remains the better choice; this is only
worth knowing because the v8 error message pushes you toward the splat form.

## F6 — the 2dp validation mechanism is missing, and the obvious substitute is worse

**Brief, §4:** "Do not use `multipleOf: 0.01` for 2dp validation; it rejects
`0.29`. **[verified]**" That is the whole treatment. But 2dp validation is a
*forced* build item, not an optional nicety: the spec describes `amount` as
"Currency amount with up to two decimal places", and §3 requires that money never
appears as a decimal inside the service boundary. Something at the ingress
boundary must reject `10.999` and turn `10.99` into `1099`. The brief rules out
the one mechanism it names and then never names another.

**Observed — the scale is much larger than stated.** Across all 1,000,001 legal
2dp amounts in the spec's `0.00`–`10000.00` range:

| Check | Legal amounts wrongly rejected |
|---|---|
| `multipleOf: 0.01` | **157,274** (15.7%) |
| `Number.isInteger(amount * 100)` | **131,256** (13.1%) |
| round-then-check-slack | 0 |

"It rejects 0.29" understates `multipleOf` by five orders of magnitude.

**The trap in the natural replacement.** Once `multipleOf` is ruled out, the
check almost everyone reaches for — and the one an AI assistant is most likely to
produce — is `Number.isInteger(amount * 100)`. It is broken for the same
floating-point reason, and it is *nastily* broken, because the obvious
spot-checks pass:

```
10.99 * 100 === 1099                    <- the amount you would test with
 0.29 * 100 === 28.999999999999996      <- 131,255 others like it
```

Anyone convincing themselves this works by trying a couple of values will
conclude it works.

**A mechanism that does work.** Round first, then assert the rounding moved the
value by less than a fraction of a penny:

```ts
const scaled = amount * 100
const pennies = Math.round(scaled)
if (Math.abs(scaled - pennies) > 1e-6) return null   // more than 2dp
```

Verified exact for all 1,000,001 legal amounts, and rejecting `10.999`, `0.001`,
`1.005`, `0.125`. Two details worth keeping:

- `Math.round(-0 * 100)` is `-0`, and `Object.is(-0, 0)` is false, so a signed
  zero survives into comparisons and `toBe` assertions. Normalise it.
- `1e2` is a legal JSON number and a legal amount; `1e999` parses to `Infinity`
  and must be rejected by a finiteness check, not by `maximum`.

**Where to put it.** `pattern` is **silently ignored on a number** — a schema of
`{ type: 'number', pattern: '^\\d+\\.\\d{2}$' }` accepts `10.999` — so the
string-pattern machinery is not an option. That leaves an Ajv **custom keyword**,
verified working:

```ts
ajv.addKeyword({ keyword: 'currencyScale', type: 'number', schemaType: 'number',
  validate: (scale, data) => Math.abs(data * 10**scale - Math.round(data * 10**scale)) <= 1e-6 })
```

This keeps §4's single-source-of-truth story intact — 2dp-ness stays declared in
the schema rather than becoming a hand-written service-layer check that ingress
schemas no longer describe. And under `strict: true` a *missing* registration is
a startup throw (`unknown keyword`), not silent acceptance. The one cost is an
ordering dependency: the keyword must be registered on the same Ajv instance
before any module-level schema constant is compiled, which is a real footgun in a
composition root.

**Brief should say:** name the mechanism, add the custom keyword to step 0
alongside the spec edits, and record `Number.isInteger(x*100)` as an explicitly
rejected option — because it is what the session will suggest.

## F7 — the Ajv + json-schema-to-ts + neverthrow seam blows up in its natural shape

> **AMENDED after the follow-up work.** The diagnosis below is correct and worth
> keeping: the blowup is real, it is a three-way interaction, and probing the
> libraries separately could not have found it. **The conclusion was too strong.**
> A working inferring shape does exist — constrain the type parameter to `object`
> so there is no `JSONSchema` union to distribute over, and apply the intersection
> at the instantiation site:
>
> ```ts
> export function isJsonValidRz<S extends object>(
>   schema: S,
> ): (body: unknown) => Result<FromSchema<S & JSONSchema>, DomainError>
> ```
>
> Verified project-wide with every explicit type argument deleted from all five
> call sites: clean `tsc`, 127 tests green, typecheck 1.9s. See **F16**, which is
> what this change bought. The paragraph beginning "The shape that does work"
> below describes the *fallback*, not the recommendation.

**Brief, §14:** "A single request end-to-end through Ajv, neverthrow, Kysely and
Express together. Each was probed alone... it is the seam most likely to be
quietly ugly in a walkthrough."

Correct prediction, and the ugliness is worse than cosmetic: **the natural shape
of the validation helper does not compile.** The obvious signature —

```ts
function validator<const S extends JSONSchema>(schema: S):
  (body: unknown) => Result<FromSchema<S>, DomainError>
```

— fails with `TS2589 Type instantiation is excessively deep and possibly
infinite` and `TS2590 Expression produces a union type that is too complex to
represent`. Runtime tests pass; only `tsc` objects, so a session that runs tests
before typechecking will build a long way on top of it before finding out.

Three fixes were tried and **all three only move the error**:

1. Annotating the inner arrow's return type.
2. Supplying explicit type arguments to `ok()` and `err()`.
3. Casting the returned function rather than the value (this one is *worse* — it
   fails even with a trivial two-property schema, where the direct value cast
   compiles).

The cause is a multiplication, not any one library: an unresolved `FromSchema<S>`
over the whole `JSONSchema` union, against the **seven-member `DomainError`
union**, inside `Result`. It is a genuine three-way interaction — none of the
three libraries misbehaves alone. Isolated reproductions of each half compile
fine, which is exactly why probing them separately (as rev 3 did) could not find
this.

**The fallback shape** — recommended by the original version of this finding, and
still the retreat if a future TypeScript reintroduces the blowup — is to stop
inferring and name the type at the call site:

```ts
export function validator<T>(schema: object): (body: unknown) => Result<T, DomainError>
// used as:
const validateCreateUser = validator<CreateUserBody>(createUserSchema)
// with, beside the schema:
export type CreateUserBody = FromSchema<typeof createUserSchema>
```

`FromSchema` is then only ever instantiated against a concrete literal schema
type, which is cheap. **The single-source-of-truth property is unchanged** — the
shape is still written exactly once, in the schema — and the cost is naming the
type at each call site, which reads better anyway. This is a good answer to have
ready, because "why isn't this inferred?" is an obvious pair-coding question.

**Two smaller items from the same seam:**

- **`ajv-formats` needs an interop cast.** Its dist does
  `module.exports = exports = formatsPlugin` while its `.d.ts` declares an ESM
  `export default`. Under `nodenext` + ESM, TypeScript types the default import
  as the module *namespace* (not callable) while Node hands you the function —
  the types are wrong about the runtime. `esModuleInterop: true` does **not** fix
  it, because `verbatimModuleSyntax` suppresses the synthesised interop. Needs
  `addFormatsCjs as unknown as (typeof addFormatsCjs)['default']`.
- **OpenAPI 3.1 is JSON Schema draft 2020-12; the default `ajv` import is
  draft-07.** If schemas are lifted from the supplied document rather than
  retyped, a `$schema` declaration alone makes compilation throw
  `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`.
  §6 treats the spec as an input to the build, so this decides whether schemas
  are copied or hand-written — worth stating which.

**Confirmed as stated:** nested `additionalProperties: false` behaves exactly as
§3 describes, including the leak when omitted. A `__proto__` key in the body is
caught as an unknown key and does not pollute the prototype, so §4's "rejecting
unknown keys closes mass assignment" holds. `strict: true` throws on a regex left
in a `format` keyword, which is what makes §6's six defects findable rather than
silent — and `strict: false` does make `accountNumber: "GARBAGE"` pass, exactly
as §4 warns.

**Minor friction, worth knowing not fixing:** `json-schema-to-ts` emits
`line2?: string | undefined`, which under `exactOptionalPropertyTypes: true` is
not the same type as `line2?: string`. It surfaces when handing a validated body
to a repository whose input type declares the latter.

## F8 — the linter advises a change that silently breaks the error handler

A consequence of F5's arity rule, but it deserves its own line because it is an
active push in the wrong direction rather than a passive gap.

`@typescript-eslint/no-unused-vars` reports the fourth parameter of the error
middleware:

```
src/http/error-middleware.ts
  27:70  error  '_next' is defined but never used  @typescript-eslint/no-unused-vars
```

The fourth parameter is the *only* thing making the function an error handler.
Taking the linter's advice demotes it to ordinary middleware, and every error in
the service starts rendering as an HTML stack trace. The lint run is green
afterwards.

**Brief should say:** configure `argsIgnorePattern: '^_'` in step 0, with the
reason in a comment, so the tooling cannot advise breaking the app. Cheap, and it
belongs next to the §8 acceptance criteria rather than being discovered mid-build
with a plausible-looking auto-fix on offer.

## F9 — a "fresh" compose Postgres inherits a stale volume, and it presents as a broken migration

**Brief:** §10 budgets step 0 for getting the database reachable, and §11's
fallback covers "the database layer is not working". Neither anticipates a
database that is reachable and working and *wrong*.

**Observed.** With a `compose.yml` declaring **no `volumes:` stanza at all**, the
first migration run failed:

```
error: relation "users" already exists
```

Inspecting the database found tables from an earlier session — including
`idempotency_keys` and `int_probe`, which this codebase never creates — and,
critically, an **empty `kysely_migration` table alongside a fully populated
schema**.

The mechanism: the `postgres` image declares
`VOLUME /var/lib/postgresql/data`, so Docker creates an *anonymous* volume even
when compose asks for none, and compose carries that volume across container
recreation. Evidenced by timestamps — the container was created at 13:32:18 and
its attached data volume dates from 08:11:02, five hours earlier:

```
Created: 2026-08-03T13:32:18Z          <- container, brand new
volume  4bccbab...  created=2026-08-03T08:11:02Z   <- its data
```

`docker compose down` without `-v` leaves the volume in place, so the ordinary
"turn it off and on again" does not clear it.

**Why this is worth a finding rather than a shrug.** The presenting symptom
accuses the wrong component. `relation "users" already exists` from
`migrateToLatest` reads as a bug in the migration, and the natural response is to
start editing the migration or reaching for `ifNotExists` — which would "fix" the
error while leaving the schema drifted from the ledger, and bake in a real bug.
Two of §11's stop-line conditions could be consumed chasing this.

It is also **reviewer-visible**, which matters more. The reviewer runs
`docker compose up`, and if they iterate at all they can land in the same state
with no way to know the cause.

**Brief should say:**
- Declare the volume explicitly in `compose.yml` and name it, so it is visible
  and so `docker compose down -v` obviously governs it.
- Do not let the test suite trust the database it is handed. A
  `drop schema public cascade; create schema public` before migrating costs tens
  of milliseconds and makes a run reproducible regardless of what the volume
  carried, including a drifted ledger. Implemented here as `src/db/reset.ts`.
- Put `docker compose down -v` in the README's troubleshooting line.

## F10 — §7's justification for the 422 is wrong, and it misreports 404 as 422

**Brief, §7:** "**Why the ownership resolve stays a separate query.** Folding
`user_id` into the conditional `UPDATE` would collapse 403, 404 and 422 into one
indistinguishable zero-row result. The separate resolve exists to keep the status
taxonomy intact — and because it runs first, **a zero-row update can only mean
insufficient funds → 422**."

The design conclusion is right. The reasoning for it is not, and the last clause
is false.

**Observed.** The ownership resolve and the conditional UPDATE are two separate
statements on two separate connections. Anything that removes the row in between
produces a zero-row update for a reason that is *not* insufficient funds:

```
resolveForOwner('01000001', 'usr-owner')  -> ok        (not 403, not 404)
DELETE FROM accounts WHERE account_number = '01000001'
debitIfSufficient('01000001', 1_000)      -> InsufficientFunds
```

Verified. The client is told **422 "Insufficient funds to process transaction"**
for an account that does not exist — and in the observed case the account had
£100.00 in it moments earlier and the withdrawal was £10.00. The correct answer
is 404.

This is not hypothetical for this build: the racing endpoint is
`DELETE /v1/accounts/{accountNumber}`, which the spec defines and §9 defers. So
the brief ships the vulnerable half and defers the half that triggers it, which
is the most likely way for this to go unnoticed.

**Why it matters more than its likelihood.** §7 is the section the brief is
proudest of, and ADR 2 is built on it. "A zero-row update can only mean
insufficient funds" is exactly the kind of confident, load-bearing claim a staff
interviewer probes in a walkthrough, and "what if the row was deleted?" is the
first question to ask. Being the one to raise it is a much better position than
being shown it.

**The fix is cheap and does not touch the happy path.** On zero rows, ask whether
the row exists at all, and map to 404 or 422 accordingly. That second query only
runs on the failure path:

```
zero rows -> SELECT account_number WHERE account_number = ?
             found     -> InsufficientFunds (422)
             not found -> NotFound (404)
```

**Brief should say:** keep the design, replace the justification. The honest
version is "the separate resolve keeps 403 distinguishable, and a zero-row update
is then disambiguated between 404 and 422 by a follow-up existence check on the
failure path only". Note also that under a serialisable isolation level this
whole class of interleaving becomes a `40001` instead — which §7 already knows
about for a different reason.

**Confirmed as stated, independently reproduced:** two £100 withdrawals from £100
gave one success, one 422, balance 0 and exactly one transaction row. Twenty
concurrent £10 withdrawals from £100 gave exactly ten successes and a zero
balance. The naive read-modify-write lost the update, taking £200 from a £100
account with both callers reporting success. REPEATABLE READ produced `40001`.
`Migrator` is indeed only on the `kysely/migration` subpath in 0.29.4 — both it
and `FileMigrationProvider` are `undefined` on the root export. All of §4's money
claims hold: int4 parses as `number`, int8 and `numeric` both come back as
**strings**, `sum(integer)` comes back as a string, and int4 overflow is a hard
error rather than a silent wrap. The "lying type declaration" is real and
demonstrable — `row.as_int8 + 1` typechecks and evaluates to the string
`'10991'`.

## F11 — account-number minting is a forced build item with no decision recorded

**Brief:** §9 puts `POST /v1/accounts` in scope. §4's closed-decisions table
covers money, locking, hashing, DI, errors, validation and testing — and says
nothing about where an `accountNumber` comes from. But the spec makes it the
resource identifier in four path templates and constrains it to `^01\d{6}$`, so
minting one is unavoidable and it contains a real decision.

**Observed.** The keyspace is exactly **10^6**: `01` is fixed and six digits are
free. Eight characters reads much larger than it is. Birthday bound:

| Accounts | Chance of at least one collision |
|---|---|
| 10 | 0.004% |
| 100 | 0.494% |
| 1,000 | 39.3% |
| 10,000 | ~100% |

A take-home will never collide. That is not the point — the point is that the
*failure mode* has to be chosen, and left unchosen it is a **500 on a request
that should have succeeded**: an unhandled `23505` unique violation, verified.

Two defensible designs, and the choice is worth one line in an ADR:

- **Postgres sequence** (`01` + zero-padded `nextval`). Cannot collide. Makes
  every account number trivially guessable and leaks the bank's total account
  count.
- **Random plus insert-and-retry.** Numbers stay opaque. Costs a bounded retry
  loop. Chosen here.

Two details the retry loop gets wrong if written quickly:

- It must retry **only** on `23505`. A foreign-key violation — user deleted
  between authentication and account creation — is not retryable; retrying burns
  four more round trips and then reports an account-number allocation failure for
  a problem that had nothing to do with account numbers. Verified both branches.
- Insert-and-retry, not check-then-insert. The unique constraint is the arbiter,
  so there is no window for a concurrent creator to take the number between the
  check and the insert.

A `CHECK (account_number ~ '^01[0-9]{6}$')` constraint is worth adding regardless
— it makes the spec's format a database invariant rather than a property of
whichever code path happened to mint the value. Verified rejecting `99999999`.

**Brief should say:** add a row to §4's closed decisions, and note that the
keyspace is small enough to be a real design point rather than an implementation
detail. It is also a good gap-register entry if a sequence is chosen for speed.

## F12 — nobody is assigned to maintain the timestamps the spec requires

**Brief:** silent. `createdTimestamp` and `updatedTimestamp` are `required` on
`UserResponse` and `BankAccountResponse`, and every mutating endpoint has to move
`updatedTimestamp`. §3's invariant list covers ownership, money, atomicity and
append-only transactions, but not this.

**Observed.** This surfaced as a typecheck error rather than a thought, which is
the interesting part. Declaring the columns
`ColumnType<Date, never, never>` — "the database owns these" — made the
repository's `updated_at: new Date()` a compile error. The type was right and the
code was wrong.

The choice it forces:

- **Application-maintained.** Every write path must remember. Forgetting is
  silent: the row is correct, the timestamp is stale, and no test that does not
  specifically assert on timestamps will notice. It also has to be remembered in
  write paths nobody has designed yet, which is precisely the PATCH endpoints §9
  defers.
- **Trigger-maintained.** One `before update` trigger per table. Unforgettable,
  and it lets the Kysely column type keep declaring `never` in the update
  position, so the type system now *enforces* that the app does not try.

Chosen the trigger here, and verified it: `debitIfSufficient` sets only
`balance_pennies`, and `updated_at` still moves while `created_at` does not.
`timestamptz` is one of the types node-postgres does parse, so these come back as
real `Date` objects — unlike int8.

Worth noting the pleasing consequence: `transactions` has **no** `updated_at`
column at all, which is part of the append-only guarantee in §3 rather than an
omission. There is nothing for an UPDATE to plausibly maintain.

**Brief should say:** one line in §3's invariant list, and one row in §4. It is a
five-minute decision that is very hard to retrofit once several write paths exist.

## F13 — §6's "note, don't build" pile is not costless

**Brief, §6:** "**Note, don't build:** the £10,000 balance ceiling with no defined
breach status; `minimum: 0.00` permitting a £0 transaction; the seven
copy-pasted 403 descriptions."

Filing these as observations is a reasonable scoping call. What the brief does not
say is that the first two mean **the service emits responses that fail the
specification it was built against**, which is a different kind of item from a
copy-pasted description.

Verified by compiling the *supplied* response schemas — transcribed verbatim, with
only §6's forced `format:`→`pattern:` rewrite applied so Ajv will load them at all
— and validating real responses against them.

**The balance ceiling.** `BankAccountResponse.balance` declares
`maximum: 10000.00`. `CreateTransactionRequest.amount` declares `maximum: 10000`.
So each individual deposit of £10,000 is legal by the request schema, and two of
them are not representable by the response schema:

```
POST .../transactions {amount: 10000, type: deposit}  -> 201
POST .../transactions {amount: 10000, type: deposit}  -> 201
GET  /v1/accounts/{n}                                 -> 200, balance: 20000
   -> fails BankAccountResponse: keyword "maximum" at /balance
```

Nothing in that sequence is a misuse of the API. Every available behaviour breaks
something: honour the ceiling and you must invent a status code the spec does not
define; ignore it and you serve a body that fails your own published schema.

**The transaction id pattern.** §6 corrective item 4 catches
`^tan-[A-Za-z0-9]$` as a path-parameter defect — "as a path-parameter validator it
400s every real request". It is *also* on `TransactionResponse.id`, which makes
response conformance **unachievable**: the pattern admits exactly one character
after the prefix, so there is no id that both satisfies it and is unique across
more than 62 transactions. Verified — it rejects the spec's own `tan-123abc`
example and accepts only `tan-a`-shaped ids.

**The £0 transaction.** This service returns 400, using
`exclusiveMinimum: 0`. The spec's `minimum: 0.00` permits it. That is a deliberate
deviation and defensible, but it is a 400 the specification does not sanction, so
it belongs in the "changes to the supplied specification" document rather than in
the observations pile.

**Brief should say:** promote the balance ceiling and the `tan-` pattern out of
"note" and into the written-up changes, because both are cases where *the
specification cannot be satisfied* rather than cases where it is merely odd. This
is cheap to do and it is a strong artefact: noticing that a spec is internally
unsatisfiable is a better signal than noticing that it has copy-pasted
descriptions. Recommend stating the chosen behaviour (allow the balance to exceed
the ceiling, and widen the id pattern) with one line of reasoning each.

**Confirmed:** `UserResponse` and `BankAccountResponse` as emitted by this service
validate cleanly against the supplied schemas in the ordinary case. §6 P7 is
confirmed as a genuinely favourable constraint — the query-scoped fetch returns
404 for a transaction requested under the wrong account number, and because
`TransactionResponse` carries no `accountId` a fetch-then-compare implementation
would have had nothing to compare.

## F14 — §4 accepts bcryptjs's "chunked on-thread hashing"; it barely chunks

**Brief, §4:** "Password hashing | `bcryptjs` | Pure JS, no native compilation, so
`npm ci` cannot break on an unknown reviewer machine. **Accepts chunked on-thread
hashing as the cost.**"

The decision is right and the reasoning is right. The cost has no number attached,
and the word "chunked" is doing more work than it can support.

**Measured** at cost factor 10, in this devcontainer:

| | Result |
|---|---|
| `bcrypt.hash` | ~52–62ms |
| `bcrypt.compare` | ~55ms (so login costs the same as signup) |
| 10 concurrent hashes | 538ms — **10.4x** one hash |
| Event-loop ticks during an async hash | **1** |
| Event-loop ticks during 50ms of genuinely yielding work | **45** |
| `hashSync` | 52ms, **0** ticks |

The async API does yield — once — so it is not identical to `hashSync`. But it is
more than an order of magnitude away from work that actually interleaves. In
practice a hash holds the event loop for ~50ms whichever API is called, and
concurrent hashes serialise completely: there is no parallelism to be had, so
ten simultaneous logins take half a second of wall clock and nothing else in the
process runs meanwhile.

**Brief should say:** keep bcryptjs — the `npm ci` reasoning is sound and 50ms is
perfectly acceptable at this scale. Replace "accepts chunked on-thread hashing"
with the number and the throughput consequence, because "~50ms per hash,
serialised, roughly 20 logins per second per process, and a worker thread or
native bcrypt is the fix at real scale" is a much better ADR line and a much
better answer under questioning than "chunked".

Worth one line too: `hashSync` is four characters away, appears in most examples,
and blocks the process outright. Using the async API is a real decision here, not
a default.

## F15 — two design moves make §3 invariants structural rather than checklist items

Not a defect in the brief — an opportunity it leaves on the table. Recorded here
because both are cheap and both strengthen the part of §3 the brief itself calls
out as unmechanised.

**§5's concession is avoidable.** §5 evaluates `eslint-plugin-neverthrow`,
correctly rejects it, and concludes: "The invariant moves to the human checklist."
So §3's "**Every `Result` is handled**" ends up as the one invariant with no
mechanical owner, and §5 identifies that as the worked example for the
gap-register bullet about where mechanisation stops.

It does not have to be. A handler adapter at the HTTP boundary makes it
structural:

```ts
function handler<T>(fn: (req: Request) => Promise<Result<Success<T>, DomainError>>): RequestHandler
```

Handler functions never receive `res`, so they have no way to send a response —
the only thing they can do with a Result is return it. `.match()` inside the
adapter is the single place in the codebase where a Result is consumed, and it is
exhaustive by construction. A handler that ignores its error channel is not a bug
you have to spot in review; it is a program that does not typecheck.

The same adapter closes §8's fifth criterion for free. §8 notes
`res.json(undefined)` is "a silent empty success, and exactly the shape a handler
falls into when a `Result`'s value is accidentally dropped". Typing the success
channel as `Success<T>` makes a dropped value a type error instead.

Stated honestly, the cost: handlers cannot stream, set custom headers, or send
anything but JSON. For this API that is a fair trade; for one with file downloads
it would not be. Verified across 20 end-to-end tests.

**Authentication as a function, not middleware.** §3 already insists ownership
checks live in the service layer, "not in middleware, not inferred from the path
parameter". The same argument applies one step earlier to authentication itself.
Middleware that mutates `req` leaves every downstream handler trusting that it
ran, and the type system cannot express that: `req.userId` is either
`string | undefined` — so every handler needs a redundant check — or it is lied
about as `string`. A function returning `Result<UserId, DomainError>` means a
handler that wants the caller's identity has to ask for it and deal with not
getting it. No ambient state, and nothing to forget to register.

**Brief should say:** add the adapter to step 1, alongside the error envelope. It
is perhaps twenty lines, it lands before any endpoint exists, and it converts the
brief's weakest invariant into a compile-time property. Then §5's honest "cost,
not correctness" defence gets a much stronger ending: the plugin was rejected
*and* the invariant was mechanised anyway, by design rather than by tooling.

---

# Follow-up work: three additions

F16–F18 record additions made after the initial nine probes, not defects found in
the brief. They are here because each closes something the earlier findings left
open.

## F16 — the validation funnel left the asserted type and the schema unbound

`isJsonValidRz` (formerly `validator`) existed to be the single place ingress
payloads are checked and typed. It had the right shape in every respect but one:
the signature was `validator<T>(schema: object)`, which left the asserted type and
the validated schema **completely independent**. This compiled cleanly:

```ts
validator<CreateTransactionBody>(createUserSchema)
```

That is precisely the mismatched-assertion hazard a single funnel is supposed to
make impossible, and it was live in two of the four route validators — which passed
hand-written inline types (`{ email: string; password: string }`) against inline
schemas. The same shape stated twice, with nothing keeping the statements in
agreement.

**Now closed, by deriving the type from the schema argument** (see the amendment at
the head of F7 for the signature). There is no second position left to get wrong,
so a mismatch is *unrepresentable* rather than something review or a linter has to
catch. Proven with a `@ts-expect-error` that fails loudly if the binding is ever
lost.

**Three risks this creates, recorded because they are the price:**

1. **A missing `as const` degrades the body to `unknown` silently.** No error
   anywhere — just a validated body you cannot read. The `as const` in
   `schemas.ts` moved from advisory to load-bearing. The first attempt at this
   change hit exactly that on the two un-`as const`ed inline route schemas, which
   is why they are now hoisted. `probe/03-validation/types.test.ts` asserts that no
   validator returns `unknown`, and demonstrates that a widened schema really does
   produce it, because the compiler will not tell you.
2. **It depends on compiler internals at one pinned version** (TypeScript 6.0.3,
   json-schema-to-ts 3.1.1, ajv 8.20.0). The fallback is written down in the module
   and in F7.
3. **The `CreateUserBody`/`CreateTransactionBody` aliases are no longer needed by
   the validators.** Kept only where a signature names the type — `JwtPayload` in
   `verifyToken`, for instance.

**A tension this surfaced, worth knowing.** `as const satisfies JSONSchema` is the
strong form of the guard, and it **rejects Ajv custom keywords** — `json-schema-to-ts`
types a closed keyword set, so `currencyScale` fails the excess-property check.
F6's 2dp mechanism and this type-level guard are therefore mutually exclusive on
`createTransactionSchema`. The keyword wins: it is the only thing enforcing "at most
two decimal places". `FromSchema` is unaffected, since it ignores keywords it does
not know.

**And a correction to my own earlier work.** The header comment in `schemas.ts`
claimed `as const satisfies` "gives an error at the schema definition if it is not a
valid JSON Schema". It satisfied `Record<string, unknown>`, which accepts any object
at all and checks nothing. Corrected.

## F17 — correlation ids and log-at-construction, and what the intersection cost

Built as an addition to the existing error design rather than a replacement, which
was the explicit requirement and the right one. `DomainError` is still a closed
union of plain data with one constructor per member and a single renderer the
compiler proves total. The seven constructors were already the chokepoint every
error is born through, so they are the seam log-at-construction needs; an
`AppError` class hierarchy would have traded compile-time totality for runtime
totality and gained nothing.

**What the intersection cost: nothing, and it added two guards.** The concern with
`(A | B | ...) & { correlationId: string }` was that the intersection might stop
distributing over the union and silently break both `switch (error.kind)` narrowing
and the `never` exhaustiveness check. Verified it does not — and adding a member now
produces **three** compile errors where there was one:

```
src/domain/errors.ts       TS2741  'BalanceCeilingExceeded' is missing in LEVELS
src/http/render-error.ts   TS2322  not assignable to 'never'   (statusFor)
src/http/render-error.ts   TS2322  not assignable to 'never'   (bodyFor)
```

The log-level map is the new guard: a member added without a level is a compile
error rather than an `undefined` level at runtime.

**Verified properties.** One id per request, not per error — the failure that would
leave the collector nothing to stitch while still appearing to work. Exactly two log
records per failed request: detail at construction, outcome at the renderer. Level
follows `kind`, so the 4xx members sit at info/warn and `Unexpected` is the only
`error`. Errors built outside a request read a named sentinel rather than an empty
string.

**The honest cost, recorded in the module.** Log-at-construction logs when an error
is *created*, which is not the same as when one *occurs*. Code that builds an error
and discards it produces a record for a non-event. Nothing does that today, but it
is a real constraint on future code, and it is the price of the guarantee that no
error can exist unlogged. Secondary cost: the constructors are no longer pure, so
the log sink defaults to silent under test and a test that cares installs a
capturing one.

**The trust-policy departure — ~~stated plainly because it looks like an
omission~~ WRONG, see F19.** This paragraph originally defended logging the full
request payload on the grounds that "what protects it is the **response boundary**,
not obfuscation". The structural half of that is true and still stands: log-only data
is a separate constructor parameter rather than fields on `DomainError`, so the
renderer cannot render what it cannot see. The conclusion drawn from it was wrong,
and it was writing plaintext passwords to the log sink. Corrected in F19.

**One knock-on worth flagging.** Adding `correlationId` to the envelope breaks
byte-equality of responses, which broke the "bad credentials are indistinguishable"
test. That test now strips the id and separately asserts both responses carry one —
otherwise it would have passed vacuously on two differing ids and quietly stopped
testing the anti-enumeration property it is named for.

## F18 — nothing checked what the service sends back

The supplied OpenAPI defines response schemas as carefully as request ones, and
until now nothing validated against them at runtime. Probe 08 compared responses to
the spec in *tests*; this puts the check in the request path. The `handler` adapter
is the natural home for the same reason it exists at all: handlers never touch
`res`, so there is exactly one point every response body passes through.

**The trap that makes this more than a copy of the ingress path.** Ajv's type checks
are `typeof`-based, so validating the in-memory object checks something the client
will never receive. Verified both halves:

- A `Date` **satisfies** `type: 'object'` and **fails**
  `type: 'string', format: 'date-time'` — while the client receives a string,
  because `JSON.stringify` calls `toISOString`.
- `{ a: 'present', b: undefined }` looks like it has `b` in memory and does not once
  serialised, so an in-memory check would miss a missing required field.

So `egressCheck` validates `JSON.parse(JSON.stringify(body))`. A failure is an
`Unexpected` → 500 with the mismatch logged, not a 4xx: a response that does not
satisfy its published schema is a bug in the service. The cost is a second
serialisation per response, which is worth paying at this scale and worth gating to
non-production at real traffic.

**THE PAYOFF, and it is bigger than conformance.** `additionalProperties: false` on
the response schemas turns §3's "no persistence entity and no password hash ever
reaches a response body" from a rule the mapping functions are *trusted* to follow
into a **checked** property. Verified: a response body carrying `password_hash`
returns 500, the hash appears in the log record, and `$2b$10$` appears nowhere in
the response. That is a third §3 invariant moved from the human checklist into the
machine, alongside the two in F15.

**This is where F13 stops being an observation and starts being a blocker.** Wiring
the *supplied* response schemas in verbatim would make the service return **500 on
legal behaviour** — two £10,000 deposits, and every real transaction id. So egress
validation forced the two F13 corrections to be made rather than noted:

- `balance` loses `maximum: 10000`. The floor is kept, and verified: a balance of
  20000 passes, −1 still fails.
- `TransactionResponse.id` becomes `^tan-[A-Za-z0-9]+$`.

Both now belong in the "changes to the supplied specification" write-up as decisions
with consequences, not as curiosities. F13 recommended exactly this; egress
validation is what made it unavoidable.

**The ingress side needed no work, and one hole is unreachable.**
`additionalProperties: false` is applied at every level including the nested
address, `__proto__` is caught as an unknown key without polluting the prototype,
and `coerceTypes: false` stops `"1000"` passing where a number is required. The one
hole Ajv structurally cannot see is **symbol-keyed properties** — it walks
`Object.keys`, which skips them. That is unreachable for request bodies, because
`express.json()` produces `JSON.parse` output, which cannot contain symbol keys or
function values. Worth one line so nobody spends time on it, and worth remembering
only when the funnel is pointed at an internally constructed object — which is
exactly what egress validation does. Verified harmless there too: `JSON.stringify`
drops symbol keys, so they cannot reach the client either.

## F19 — F17's trust policy was wrong, and it was logging plaintext passwords

**This is a correction to my own work, not a finding about the brief.** It is here
rather than quietly fixed in a commit because the failure was in the *reasoning*, and
reasoning that produced a confident wrong answer is worth keeping visible.

**What was wrong.** The ingress branch of `isJsonValidRz` passed `payload: body` into
`validationFailed`, and `build()` spread it into the emitted record. Because the
signup schema sets `password` to `minLength: 12`, the values written were real
credentials rather than placeholders: **every failed signup and every failed login
validation wrote the supplied password to the log sink as JSON.** Probe 10 contained
a *passing test asserting exactly that*, which is a considerably worse artefact than
an untested oversight.

**Why the defence was wrong, precisely.** F17 said "what protects it is the response
boundary, not redaction." The response boundary protects **the client**. It says
nothing about who reads the logs — and a log store is where credentials go on to have
a long, widely-replicated and badly-governed life. Every large plaintext-password
incident of the last decade (Facebook, Twitter, GitHub) was this shape, not a database
breach. Having reasoned about the threat and reached the wrong conclusion is worse
than not having considered it, because it means the mistake was load-bearing.

**The fix is a deletion.** The payload is not logged. Nothing diagnostic is lost:
`details` already names every offending field and keyword, and `schemaPaths` gives the
schema structure. The payload's only additional contribution was the *values*, which
are simultaneously the sensitive part and the least useful part for debugging a schema
mismatch. `payloadKeys` — `Object.keys(body)`, shape without content — replaces it,
and answers the question the payload was actually consulted for: was the field
misspelled, absent, or unexpected. That adds no new exposure class, because unknown
key names already reach the client in `details[].field`.

**Not a denylist.** A denylist on key names fails open, and the next
credential-bearing field will not be called `password`.

**The asymmetry is the interesting part, and it is now enforced by the type system.**
The same funnel keeps the payload on the *egress* call and loses it on the *ingress*
call:

- **ingress** → `validationFailed` → payload forbidden. The body is client-supplied
  and may be anything.
- **egress** → `unexpected` → payload permitted. That body is the service's own
  output, response schemas exclude `password_hash` (F18), and when a response fails
  its published schema the payload is the entire diagnostic.

A deletion is only as durable as the next person's memory, and `LogOnly`'s index
signature would have accepted a re-added `payload` in silence. So the six
client-reachable constructors take `PayloadForbidden = LogOnly & { payload?: never }`
and `unexpected` keeps `LogOnly`. Re-adding the payload to an ingress call is now a
compile error; the escape hatch for egress still compiles. Verified both directions.

**One adjacent assumption, checked because it is the same leak class one layer over.**
`details[].message` comes from Ajv and goes to **both** the log and the client, so if
Ajv ever embedded the offending value in a message, the deletion above would not be
enough. It does not — verified across every keyword this API uses:

```
required             must have required property 'missing'      params: {missingProperty}
additionalProperties must NOT have additional properties        params: {additionalProperty}
minLength            must NOT have fewer than 12 characters     params: {limit}
format               must match format "email"                  params: {format}
minimum              must be >= 1000                            params: {comparison, limit}
enum                 must be equal to one of the allowed values  params: {allowedValues}
```

Property names and schema constraints, never values. `toFieldError` takes only
`message`, `keyword` and the field name — not `params` — so even `allowedValues` does
not reach the client.

**Now asserted, at three widths**, because a single narrowly-aimed assertion is what
let the original problem look tested:

1. Per-path: a real credential appears in neither the response nor any log record, for
   failed login validation and failed signup.
2. Whole-session sweep: signup, a wrong-password 401, a successful login and an
   authenticated request — then search the entire sink for the credential, the
   attempted wrong credential, and `$2b$` (the bcrypt hash, which would be
   offline-crackable).
3. Compile-time: re-adding `payload` to an ingress constructor does not typecheck.
