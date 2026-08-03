# Probe log — problems the brief will hit

This repo is not a candidate implementation. It is a set of experiments, each one a
deliberate attempt to break a claim in `build-brief.md` (as summarised in the advisory
brief's section 3) or in the supplied OpenAPI spec, run against real Postgres and real
HTTP. Every finding below is reproducible: `docker compose up -d && pnpm test`.

**Caveat on scope:** I was given the advisory brief, not `build-brief.md` itself. Where
a finding below is already covered in the build brief, treat it as corroboration rather
than news.

Full suite: 11 files, 54 assertions, all passing, `tsc --noEmit` clean.

---

## Verdict on each settled decision

| Decision (brief §3) | Verdict | Probe |
|---|---|---|
| One JSON Schema drives Ajv + `FromSchema` types | **Holds** | 01 |
| Ajv for validation, schemas at every boundary | **Holds, but not against the spec's schemas as written** | 02 |
| Integer pennies as `number` in a `BIGINT` column | **Broken as stated; needs a type parser, or a different column type** | 03 |
| `neverthrow` for errors | **Holds at the HTTP boundary; collides with Kysely transactions** | 04, 06 |
| Conditional `UPDATE ... WHERE balance >= $1` under READ COMMITTED | **Correct, including both stated caveats** | 05, 09 |
| Reject unknown keys everywhere "including the decoded JWT payload" | **The JWT half is impossible as stated** | 07 |
| Express 5, manual composition root, Postgres via compose | **Holds** | 07–09 |

---

## Findings that will cost real time

### 1. `err()` inside a Kysely transaction commits the partial work — probe 04

The single most expensive finding. Kysely's `db.transaction().execute(cb)` rolls back
when `cb` **throws**. An errors-as-values codebase never throws, so returning
`err({ kind: 'INSUFFICIENT_FUNDS' })` resolves the callback normally and Postgres
**commits**.

The probe demonstrates a phantom £500 withdrawal persisted to the ledger while the
service correctly returned 422. Balance right, ledger wrong, no error anywhere.

This is a direct collision between two decisions that were each settled in isolation.
The fix is in `src/domain/service.ts` as `runTx`: a private `Rollback` carrier thrown
inside the callback and converted back to `err()` outside it. Every multi-statement
operation must go through that one helper — which is a discipline requirement, exactly
the thing the brief's author prefers to replace with tooling. Worth deciding whether to
make the raw `db.transaction()` inaccessible (wrap the `Kysely` instance) rather than
relying on remembering.

**Interview relevance:** high, and in your favour. "Errors-as-values needed an adapter
at the transaction boundary, and here is the adapter" is a much better answer than not
having noticed.

### 2. `BIGINT` pennies arrive as strings, silently — probe 03

`node-postgres` returns `int8` (OID 20) as a **string**. A hand-written Kysely column
typed `number` is a lie the compiler cannot catch:

- `pence / 100` coerces, so responses look correct — the bug hides behind a passing test
- `pence + 500` concatenates to `'1099500'`
- `count(*)` is also `int8`, and `count(*)` is the guard for the DELETE-user 409 rule.
  `Boolean('0')` is `true`, which is the exact shape of "user with accounts gets deleted"

Fix implemented in `src/db/connect.ts`: a global OID-20 parser with a
`Number.isSafeInteger` assertion.

**But the better question is whether `BIGINT` was right at all.** The spec caps a
balance at £10,000 = 1,000,000 pence. `INTEGER` holds 2,147,483,647 pence (£21.4m) and
is returned as a **native JS number with no parser**. `BIGINT` buys no headroom that
matters here and is the specific choice that creates the bug class. `NUMERIC` is worse
again — also a string, by design.

I'd flag this as the one settled decision worth reopening. `BIGINT` is defensible for a
real ledger (a total-value or turnover column genuinely can exceed 2^31 pence) but that
is an argument to make deliberately. Either answer interviews well; drifting into
`BIGINT` and then patching the parser interviews worse than choosing `INTEGER` on range
analysis, or choosing `BIGINT` and explaining the parser as a deliberate cost.

Note also that `setTypeParser` is **process-global module state**. You cannot have
parsed and unparsed `int8` coexisting, and any dependency assuming string `int8` changes
behaviour the moment you install it.

### 3. `multipleOf: 0.01` rejects 15.7% of legal GBP amounts — probe 02

The spec puts no precision constraint on `amount`, so `10.999` and `0` and `1e-9` are
all valid as written. The obvious fix is `multipleOf: 0.01`. It rejects **157,274 of the
1,000,001** legal amounts, including **£0.07**, £0.29 and £1.11 — because `0.07 / 0.01`
is not an integer in IEEE-754.

The reliable guard is the string representation: `/^\d+(\.\d{1,2})?$/.test(String(n))`.
The probe verifies it is exact across all 1,000,001 values. Implemented in
`src/domain/money.ts` as a domain check rather than a schema keyword, which is a small
but real deviation from "schemas at every boundary".

**And one that cannot be fixed at all:** `JSON.parse('10.9999999999999999999')` is `11`.
Precision is destroyed by the parser before any validator runs. Probe 08 shows a client
asking for £0.99999… being charged £1.00 with a 201. The only true fix is a string money
type on the wire, which the supplied spec forbids. This is a good thing to volunteer —
it demonstrates knowing where the boundary of your own defence is.

### 4. Rejecting unknown keys on the JWT payload rejects your own tokens — probe 07

Brief §4.4 says schemas must reject unknown keys "including the decoded JWT payload".
`jsonwebtoken` adds `iat` and `exp`. A schema declaring only `sub` with
`additionalProperties: false` therefore **401s every token the service issues**.

The defensible version, implemented in `src/domain/tokens.ts`: allow the registered
claims, read only `sub`, validate its shape, and never spread the payload anywhere. The
mass-assignment argument survives intact — it just doesn't apply to the JWT the way §4.4
currently words it.

Two related things the probe confirms are fine: an `alg: none` token is rejected, but
**only** because `algorithms: ['HS256']` is pinned in `verify()`. Remove that option and
the attack lands. That is worth a sentence in the README, because it is the one JWT
question a security-minded reviewer always asks.

### 5. The spec contradicts itself on the balance ceiling — probe 08

`CreateTransactionRequest.amount` maximum is 10000. `BankAccountResponse.balance`
maximum is also 10000. So **two individually-legal £10,000 deposits produce a response
that violates the spec's own schema** — and there is no status code defined for refusing
a deposit that would breach the ceiling. Worse, that balance then cannot be withdrawn in
a single transaction, because the withdrawal amount is capped at 10000 too. A customer
can be put into a state they cannot exit in one operation.

Three options, all deviations: treat 10000 as a business rule and invent a 422; treat
the response maximum as documentation and knowingly emit non-conforming responses; or
cap the balance and reject the deposit with 400. Pick one and put it in the gap register.
Nothing in the brief currently records this.

Probe 08 also demonstrates the cheap way to find things like this: compile the spec's
own response schemas with Ajv and assert responses against them in the integration
tests. That is ~20 lines and it is the closest thing to "deterministic tooling replacing
discipline" available for spec conformance here.

### 6. The scenarios mandate an enumeration oracle — probe 07

`GET /v1/users/{userId}`: another user's real id → 403; a fabricated id → 404. So
existence must be established **before** ownership, which makes the endpoint a
user-enumeration oracle **by specification**. Same for accounts — and the account
number space is only `^01\d{6}$`, i.e. 10^6 wide, enumerable at ~403-vs-404, and the
account number is the public identifier.

This cannot be fixed without deviating from the scenarios. It should be **recorded**,
because "why 403 here and 404 there, would you design it that way?" is on the brief's
own list of likely questions, and the strong answer is: "no — I'd return 404 for both,
because the 403 leaks existence; the spec asked for 403 so I built 403 and wrote it up."

### 7. Account number generation is unspecified — `src/domain/ids.ts`

`^01\d{6}$` is 10^6 values and it is the public account identifier. Sequential
allocation makes every other customer's account trivially guessable. Random allocation
collides fast — the birthday bound puts you at **1% collision probability by 142
accounts** and **50% by 1,177** — so the generator needs a uniqueness retry, which
`src/domain/ids.ts` has. The brief does not mention account number generation at all,
and it is a nice small thing to have an opinion about.

### 8. Kysely's naive table interface will not compile INSERTs

The obvious `balance_pence: number` interface fails to compile for `insertInto`, because
Kysely demands every column unless defaulted ones are wrapped in `Generated<T>`. The
failure mode to avoid is what I did in the early probes: reach for `as never` to force
it through, which silences exactly the checks the stack was chosen for. `Generated<>`
and `ColumnType<>` are the real fix — see `src/db/types.ts`.

Related trap in the same file: a JSONB column typed as its object shape will be stored
as the literal text `[object Object]`. Declaring it `ColumnType<Address, string, string>`
makes forgetting to stringify a compile error.

### 9. The type safety is not end-to-end, and tests are load-bearing — probe 12

`src/db/types.ts` is an **assertion** about `schema.sql`, not a derivation from it.
Nothing checks them against each other. The probe shows:

- a nullable column typed non-nullable compiles and yields `null` at runtime, surfacing
  as a `TypeError` at an arbitrary call site far from the cause
- a column that does not exist compiles and fails at query time with `42703`

So DB-backed integration tests are **not optional** — they are the only thing catching
this class. That is a real constraint on a 12-hour budget and it is better said out loud
than left implicit while presenting the stack as type-safe. Given the brief's stated
preference for tooling over discipline, `kysely-codegen` (generate types from the live
schema, commit them, fail CI on drift) is the on-brand answer, and it is cheap.

---

## Smaller frictions, in rough cost order

- **Vitest runs test files in parallel workers against one shared compose Postgres**, so
  integration files truncate each other's fixtures and fail with `no result` — a failure
  that looks like a connection bug and is not. `fileParallelism: false` in
  `vitest.config.ts`, with the tradeoff documented. Even serialised, files inherit each
  other's leftovers: probe 03 had to start deleting `transactions`, a table it never
  writes to, to survive running after probe 12. Decide the isolation strategy up front
  (schema-per-worker, transaction-rollback-per-test, or serial) rather than discovering
  it at hour eight.
- **`transactionId` pattern `^tan-[A-Za-z0-9]$`** matches exactly one character and
  rejects the spec's own documented example `tan-123abc`. If you validate path params
  against the spec, every transaction fetch 400s.
- **The spec uses `format:` where it means `pattern:`** in five places
  (`BankAccountResponse.accountNumber`, `UserResponse.id`, `CreateUserRequest`/
  `UpdateUserRequest.phoneNumber`, `TransactionResponse.userId`). Under Ajv **strict**
  mode this throws `unknown format` — which is the good outcome. With strict off it
  silently validates nothing: `'banana'` passes as an account number. Keep strict on.
- **`CreateUserRequest` collects no credential**, but every other endpoint requires a
  bearer token. As supplied, no user can ever authenticate. Adding `password` is
  unavoidable and must be declared in the spec you submit — it is arguably the single
  most visible deviation, so lead with it rather than burying it.
- **`amount` minimum is 0**, so a zero-value transaction is valid per the spec and
  violates any sane `CHECK` constraint — a 500 unless you use `exclusiveMinimum`.
- **`UpdateUserRequest`/`UpdateBankAccountRequest` have no `required` and no
  `minProperties`**, so `{}` is a valid PATCH. Deferred, but it is the deferral note.
- **The two supplied documents disagree on a path parameter name**: the scenarios say
  `accountId` throughout, the spec says `accountNumber`. Pick the spec and say so.
- **pnpm 11 blocks *every* script until build approvals are resolved.** This one bit
  the reader of this repo before it bit me, because I ran the probes with
  `npx vitest run` and never exercised `pnpm test`. Chain of events:
  1. The Dockerfile pins `pnpm@10.21.0`, but with no `packageManager` field corepack
     fetched **11.18.0** instead. `pnpm init` then writes a *range* (`^11.18.0`) that
     corepack refuses outright.
  2. pnpm 11 no longer reads `pnpm.onlyBuiltDependencies` from `package.json`; it warns
     and ignores. The setting moved to `pnpm-workspace.yaml`.
  3. But in pnpm 11 the key is **`allowBuilds: { <pkg>: true|false }`**, not
     `onlyBuiltDependencies`. When it encounters a blocked build script, pnpm *writes a
     placeholder into your `pnpm-workspace.yaml` itself* —
     `esbuild: set this to true or false` — which is a string, not a boolean, so the
     approval stays unresolved.
  4. pnpm 11 verifies dependency status **before running any script**, so an unresolved
     approval means `pnpm test` exits 1 with a stack trace from `runDepsStatusCheck`,
     never reaching vitest. The error names `esbuild`, which looks like a build problem
     and is actually a config problem.

  Fix: pin `packageManager` explicitly, and resolve every entry in `allowBuilds` to a
  real boolean. Escape hatch if it ever gets in the way mid-session:
  `pnpm --config.verify-deps-before-run=false test`.

  **Lesson for the real build:** run the *scripts* at least once, not just the
  underlying tools. `npx vitest run` passing tells you nothing about `pnpm test`. The
  `npm ci` in §4.4 is `pnpm install --frozen-lockfile` here.
- **`import Ajv from 'ajv'` does not typecheck** under `module: nodenext` +
  `verbatimModuleSyntax`, though it runs fine — TS resolves the CJS default to the
  namespace object. `import { Ajv } from 'ajv'` works; `ajv-formats` has only a default
  export and needs a cast. Ten minutes, but confusing ten minutes.
- **`node-postgres` has no acquire timeout by default.** Probe 09 fires 60 concurrent
  withdrawals at a `max: 20` pool: all succeed, nothing 500s, and the ledger
  reconciles — but saturation would present as *hung requests* rather than a fast 503.
  One line of config, and a good thing to know when asked about failure modes.
- **Tests import `../src/http/app.ts`** happily under Vitest while `tsc` rejects the
  `.ts` extension. A green test run is not a green typecheck; run both in CI.

---

## What held up well

Worth saying plainly, because these are the load-bearing claims and they survived.

- **The concurrency argument is correct, as written, including its caveats** (probes 05,
  09). Two concurrent £60 withdrawals against £100: one 201, one 422. Twenty concurrent
  £10 withdrawals: exactly ten succeed, no 5xx, and the stored balance equals the sum of
  the ledger. Both stated caveats reproduce: application-side read-modify-write silently
  loses an update (£120 withdrawn from £100, with a *plausible-looking* balance and no
  constraint violation), and REPEATABLE READ raises `40001` without retry logic. This is
  the strongest part of the brief and it is now empirically defensible rather than
  merely argued.

  One addition: the brief frames `FOR UPDATE` as needed only if the read-modify-write is
  in application code. In practice the **ownership check** needs it too — otherwise a
  concurrent account deletion races the transaction insert and trips the foreign key as
  a 500 instead of a 404. See `createTransaction` in `src/domain/service.ts`.

  Also: a bare conditional `UPDATE` returning 0 rows cannot distinguish 422 from 404
  from 403. You need the locking `SELECT` first regardless, which the brief's phrasing
  doesn't quite reach.

- **`Result` genuinely plays a covering role** (probe 06). `DomainError` is a closed
  union; `toHttp` switches over it ending in `unreachable(e: never)`. Adding a domain
  outcome without deciding its status code is a **compile error**, not an accidental
  500. That is the demonstrable version of the §4.5 claim.

- **Mass assignment is closed** (probe 07). `additionalProperties: false` means
  `{"balance": 1000000}` on account creation is a 400 naming the offending field, not a
  silent strip. `__proto__` in a JSON body does not reach the prototype.

- **Async `scrypt` for password hashing** (`src/domain/password.ts`). The §4.3 framing is
  right and can be sharpened: `crypto.scrypt` hands work to libuv's threadpool, whose
  **default size is 4**. That — not the event loop — is the real capacity limit on the
  login endpoint, and `UV_THREADPOOL_SIZE` is the knob. Naming it is a much better
  answer than "the workload is IO-bound".

---

## Pair-coding extension prep (§4.8) — both headline items have traps

### Transfers between accounts deadlock — probe 10

The natural implementation locks the source row then the destination row, in request
order. Two opposing transfers deadlock: Postgres detects it and kills one side with
`40P01` — but only after `deadlock_timeout`, a **full second** of held locks, and the
victim is a 500 unless caught and retried.

The fix is a **total lock order** independent of the request (sort by account number).
The probe shows it surviving 16-way crossfire with exact net-zero balances. This is a
30-second answer if you have it ready and a very uncomfortable ten minutes if you don't.

### Idempotency keys are right in outline, under-specified in three places — probe 11

The briefed design — client key, unique constraint, return the original on replay —
works for sequential **and** concurrent replay; the probe confirms both, with the key
claim and the balance update in one transaction. What it does not yet say:

1. **The replay branch has nothing to return while the original is in flight.** The
   `23505` aborted your transaction, so reading the original needs a fresh one — and if
   the original hasn't committed, `transaction_id` is still `NULL`. The honest answer is
   409 "a request with this key is in progress". Guessing at this live costs minutes.
2. **The same key with a *different* amount is accepted as a replay.** The probe fires
   `k4` at £10 then `k4` at £90; the £90 request vanishes with a success-ish reply.
   Stripe's answer is to fingerprint the request body against the key and return 422 on
   mismatch. This is the detail that separates *has read about* idempotency keys from
   *has operated* them — which is exactly the signal the brief says this extension sends.
3. **A rolled-back original releases the key**, so a legitimately-failed request is not
   deduplicated on retry. Usually correct, but it means a client that timed out cannot
   distinguish "failed, safe to retry" from "succeeded, reply lost".

---

## Two challenges to the brief itself

**§4.4's headline mitigation defends code that §3 deferred.** Prototype pollution is
introduced as biting "exactly where this spec lives: `PATCH` handlers that merge
unvalidated JSON" — and all `PATCH` handlers are deferred. As it stands you would be
defending an attack surface you did not build. Either keep the argument but frame it as
*why the deferred handlers will be written that way*, or move the emphasis to mass
assignment on `POST`, which you can actually demonstrate. Probe 07 shows the
demonstrable version.

**§4.5 overclaims slightly, and the overclaim is exactly what a sharp reviewer will
test.** "The compiler enforces handling it" is not true of `neverthrow`: an unhandled
`Result` is silently discarded, there is no `no-floating-promises` equivalent, and
`unwrapOr(0)` collapses a 422 into zero pounds. Probe 06 demonstrates all three. What
*is* true and provable is narrower and stronger: **the compiler enforces exhaustive
mapping at the boundary.** Say that instead. It survives the follow-up question.

Related, and in the same spirit: deferring `DELETE /v1/users/{userId}` drops the **only
genuine business rule** in the whole exercise — the 409 when a user still holds accounts.
Everything else is CRUD plus one balance check. If there is room for one more endpoint
beyond the settled scope, that is the highest-signal one, not another fetch.
