# Residual risk catalogue

Every limitation in this service that was chosen rather than encountered. Each
entry states what was chosen, what it costs, the specific sequence that triggers
it, and what would close it.

**A note for anyone picking this up during the build.** This document is
pre-populated. Entries are written in the present tense — "chosen", "what it costs" —
because they describe the *intended* design and the trades already decided, several of
which were established by adversarial probe work rather than by this codebase. Until a
slice is built, the corresponding entry is a target rather than a record. Do not read
an entry as evidence that the code exists; do add to it the moment a trade is actually
taken.

Two rules govern what appears here. **No entry without a trigger and a fix** — if
neither exists, it is a note for the README rather than a risk. And **entries are
written when the decision is taken**, not reconstructed at the end, so the order
below is roughly the order in which each trade was made.

Scope is deliberately narrow: create-and-fetch for users, accounts and
transactions, plus login. `PATCH` and `DELETE` are absent by decision, and the
reasoning is entry R2; the two list endpoints are absent by a different decision,
and the reasoning is entry R34.

---

## Summary

| | Risk | Severity | Likelihood as built |
|---|---|---|---|
| R1 | A withdrawal against a concurrently-deleted account reports 422 rather than 404 | Medium | Very low — requires the deferred delete endpoint |
| R2 | `PATCH` and `DELETE` endpoints not implemented | Low | n/a — documented scope |
| R3 | No idempotency on transaction creation | **High in production** | Certain under client retry |
| R4 | Transaction list is unpaginated | Medium | Grows with account age |
| R5 | User deletion would be a hard delete | **High in production** | n/a — not implemented |
| R6 | No rate limiting or lockout on the auth endpoint | Medium | Certain under attack |
| R7 | 403 on another user's resource confirms that it exists | Low | Certain, by specification |
| R8 | £0 transactions are accepted | Low | Certain |
| R9 | Account balances may exceed the ceiling the specification publishes | Low | Requires >£10,000 |
| R10 | Password hashing is serialised on the event loop | Medium | Certain above ~20 logins/second |
| R11 | Two-decimal-place validation is asserted in two places | Low | n/a — design trade |
| R12 | Test-suite database connections scale with the number of test files | Low | Grows with the suite |
| R13 | Handlers cannot stream, set custom headers, or return non-JSON | Low | n/a — design trade |
| R14 | TypeScript is pinned one major version behind | Low | Certain |
| R15 | Concurrency behaviour is asserted by test, not by a formal argument | Low | n/a |
| R16 | Nothing forces a new boundary to use the validation funnel | Medium | Grows with contributors |
| R17 | A `Result` created and dropped inside a service has no mechanical check | Medium | Silent when it happens |
| R18 | The reviewer needs pnpm, and the build-script allowlist must be committed | Low | Certain on a clean machine |
| R19 | A schema missing `as const` degrades its validated type to `unknown` silently | **High if it happens** | Low — covered by a type-level test |
| R20 | The validation inference depends on one pinned TypeScript version | Medium | On any TypeScript upgrade |
| R21 | Errors log at construction, which is not the same as at occurrence | Low | Only if future code builds and discards |
| R22 | Correlation ids are not accepted from upstream callers | Low | n/a — single service |
| R23 | Every response body is serialised twice | Low | Certain, immaterial at this scale |
| R24 | The payload-logging ban guards one key name, and one constructor is exempt | Low | Only via future call sites |
| R25 | Log record values can be attacker-controlled, via any rejected field name | Low | Certain, and harmless with a JSON sink |
| R26 | Validators compile at module load, not ahead of time | Low here, blocking elsewhere | Certain — a capability not present |
| R27 | The commit gate is local, opt-in per clone, and checks the working tree | Low | Certain on a fresh clone |
| R28 | The Result naming rule sees bindings, not every position a `Result` can occupy | Low | On the first `Result`-typed class property |
| R29 | `allErrors: true` makes validation effort scale with how invalid a body is | Low | Bounded by a stated body-size limit |
| R30 | The published request schemas describe something looser than the service enforces | Medium | Certain for any client generated from the specification |
| R31 | The test suite resets once per run, not between test files or tests | Low now, Medium from step 2 | Certain once two files write the same table |
| R32 | Local development credentials are committed in `compose.yml` | Low | Only if the values are reused outside a developer machine |
| R33 | The log sink has no level threshold, and every error logs | Low now, Medium under real traffic | Certain — an unmatched-route scan is enough |
| R34 | Two specified list endpoints are not built | Low | Certain — both paths answer 404 |

---

## R1 — Withdrawal against a concurrently-deleted account reports 422, not 404

**Chosen.** The withdrawal is a conditional `UPDATE ... WHERE balance >= $1`
inside an explicit transaction, with the ownership resolve as a separate prior
query. On a zero-row update, a follow-up existence check distinguishes 404 from
422. That second query runs only on the failure path.

**What it costs.** The ownership resolve and the debit execute on different
connections, so the sequence is not atomic with respect to *status*. It is atomic
with respect to the balance: the new value is always computed from the row's
current value inside the database, so no update is ever lost. The existence check
narrows the misreport window to microseconds rather than eliminating it.

**How you would trigger it.** Resolve ownership successfully; delete the account
row; issue the debit. The update matches zero rows and the existence check now
also finds nothing, so 404 is returned — correct. The remaining window is the
inverse: the row is deleted after the failed update and re-created before the
existence check, or vice versa. The only endpoint that deletes an account is
`DELETE /v1/accounts/{accountNumber}`, which is not implemented here (R2).

**What closes it.** Move the ownership resolve into the same transaction and take
a row lock:

```sql
BEGIN;
SELECT user_id FROM accounts WHERE account_number = $1 FOR UPDATE;
UPDATE accounts SET balance_pennies = balance_pennies - $2
 WHERE account_number = $1 AND balance_pennies >= $2 RETURNING balance_pennies;
INSERT INTO transactions ...;
COMMIT;
```

Under the lock the row cannot vanish, so a zero-row update genuinely can only
mean insufficient funds and all three statuses are correct atomically. Cost: one
extra round trip inside the transaction, and concurrent access to a single account
serialises. Roughly thirty minutes including tests. Not taken because the
lock-free version is correct for the money and the status gap is unreachable
without R2.

---

## R2 — `PATCH` and `DELETE` endpoints not implemented

**Chosen.** Create and fetch for all three resources, plus login and the two list
endpoints. All `PATCH` and `DELETE` paths deferred.

**What it costs.** Four specified behaviours are absent, and one of them is the
most interesting in the specification: `409 Conflict` when deleting a user who
still holds accounts. `PATCH` is also where mass-assignment risk concentrates,
so the endpoint that most exercises the validation strategy is the one missing.

**How you would trigger it.** Any `PATCH` or `DELETE` request returns 404 from the
fallback handler rather than the specified status.

**What closes it.** Both are cheap now that ownership resolution, the error
envelope and the handler adapter exist — perhaps ninety minutes for all of them.
`PATCH` needs no new validation machinery: the ingress schemas already reject
unknown keys, including on nested objects, so `{"balance": 1000000}` is a 400
rather than a silent field write.

**Worth stating plainly:** deferring `DELETE /v1/accounts/{accountNumber}` is
precisely what makes R1 unreachable. The vulnerable half shipped and the half that
triggers it did not. That is a coincidence of scoping, not a mitigation.

---

## R3 — No idempotency on transaction creation

**Chosen.** `POST /v1/accounts/{accountNumber}/transactions` has no idempotency
mechanism. A retried request creates a second transaction.

**What it costs.** In production this is the difference between a payments system
and a CRUD application. A client that times out waiting for a response has no safe
way to retry a withdrawal.

**How you would trigger it.** Submit a withdrawal; drop the response; submit the
identical request again. Two transaction rows, twice the money moved.

**What closes it.** A client-supplied `Idempotency-Key` header, a unique
constraint on `(account_number, idempotency_key)`, and a stored response body
returned unchanged on replay. Insert the key as part of the same transaction as
the debit so the two cannot disagree. The interesting design questions are what
happens when the same key arrives with a *different* body (409, not a replay) and
how long keys are retained. Perhaps two hours done properly.

---

## R4 — Transaction list is unpaginated

**Chosen.** `ListTransactionsResponse` defines no pagination fields, so the endpoint
it describes returns every transaction on an account.

**This is a risk the endpoint inherits rather than one currently running.** The
endpoint itself is not built — see R34 — so nothing in this service is unpaginated
today. The entry stays because the *specification* is what carries the decision, and
whoever adds the endpoint inherits it without being asked. That includes anyone
following the README walkthrough, which is why the walkthrough points here.

**What it costs.** Response size and query time grow without bound with account age.
An old account is a slow request and a large payload.

**How you would trigger it.** Build the endpoint as specified, create several thousand
transactions, and list them.

**What closes it.** Keyset pagination on `(created_at, id)` rather than
`OFFSET` — offset pagination degrades on exactly the access pattern a transaction
list has, and skips or duplicates rows when new transactions arrive between pages.
Requires adding fields to the response schema, so it is also a specification
change.

---

## R5 — User deletion would be a hard delete

**Chosen.** Not implemented (R2). Had it been, the migration as written supports
only a hard delete.

**What it costs.** A bank cannot truly delete a user. Transaction history must
survive for regulatory retention, and a deleted user's historical transactions
must remain attributable.

**How you would trigger it.** Not reachable as built.

**What closes it.** A `deleted_at` column, every read path filtering on it, and a
separate audit table recording who changed what and when — append-only, like
`transactions`. The retention question (what is *actually* erasable under a
subject-access request when the ledger is immutable) is a genuine design problem
rather than an implementation detail, and it deserves more than a column.

---

## R6 — No rate limiting or lockout on the auth endpoint

**Chosen.** `POST /v1/auth/login` accepts unlimited attempts.

**What it costs.** Credential stuffing and password brute-forcing are
unthrottled. Because hashing is serialised (R10), a flood of login attempts is
also a cheap denial-of-service against the whole process: each attempt occupies
the event loop for ~50ms regardless of whether the password is right.

**How you would trigger it.** Submit login attempts in a loop. Nothing slows down
and nothing locks out. Twenty concurrent attempts consume a second of wall clock
during which no other request is served.

**What closes it.** Two separate mechanisms, and they are not interchangeable: a
per-IP request limit (cheap, in-process for a single instance, needs shared state
for more than one) and per-account attempt tracking with a backoff or lockout.
The second is the one that matters for credential stuffing, since a distributed
attack defeats per-IP limits. Lockout then introduces its own denial-of-service
against a legitimate account holder, which is why backoff is usually preferred.

---

## R7 — 403 on another user's resource confirms that it exists

**Chosen.** Implemented exactly as specified: 403 when a resource exists but
belongs to another user, 404 when it does not exist.

**What it costs.** The distinction is an oracle. A caller can enumerate valid
account numbers by observing which return 403 and which return 404. The keyspace
is 10^6, so enumeration is entirely feasible.

**How you would trigger it.** Authenticate as any user and request account
numbers in sequence. 403 means the account exists.

**What closes it.** Return 404 for both cases. This is the
security-conservative choice and it is what I would argue for in a real system.
It was not taken here because the specification defines the 403 behaviour
explicitly across seven endpoints, and conformance to the supplied specification
is the stated requirement. Deviating silently would be worse than either option.

---

## R8 — £0 transactions are accepted

**Chosen.** `minimum: 0.00` in `CreateTransactionRequest` is implemented as
written, so a £0 deposit or withdrawal succeeds and creates a transaction row.

**What it costs.** A zero-value transaction is meaningless and pollutes the
ledger. It is also a free way to generate unbounded rows.

**How you would trigger it.** `POST` a transaction with `amount: 0`. It returns
201.

**What closes it.** `exclusiveMinimum: 0`, one line. Not taken because the
specification permits £0 and returning 400 would be a status the specification
does not sanction. My preference is the opposite of what is implemented, and this
entry exists to say so.

---

## R9 — Balances may exceed the ceiling the specification publishes

**Chosen.** `BankAccountResponse.balance` and `CreateTransactionRequest.amount` both
declare `maximum: 10000.00` in the supplied specification. Two legal deposits therefore
produce a balance the response schema cannot represent. The `maximum` was removed from
the response schema and the balance is allowed to grow.

> **Corrected during the build, at slice 0c.** This entry previously gave the second
> ceiling as `maximum: 10000`, which reads as though the two values differ and that the
> difference is the defect. They are numerically identical; the unsatisfiability comes
> from two legal deposits summing past a ceiling that applies to their total. Verified by
> parsing the document. The conclusion is unchanged.

**What it costs.** A deviation from the supplied specification, recorded in
`docs/spec-changes.md`.

**How you would trigger it.** Two deposits of £10,000. Both return 201; the
account then reports a balance of £20,000, which fails the original
`BankAccountResponse` schema on the `maximum` keyword.

**What closes it.** Nothing closes it cleanly, which is the point — the
specification is internally unsatisfiable here. Honouring the ceiling requires
inventing a status code the specification does not define for the rejected
deposit; ignoring it means serving a body that fails the published schema. The
deviation chosen is the one that keeps every request/response pair
self-consistent. A real system would define a ceiling *and* the status for
breaching it, most likely 422.

---

## R10 — Password hashing is serialised on the event loop

**Chosen.** `bcryptjs` — pure JavaScript, no native compilation, so `npm ci`
cannot fail on an unfamiliar machine. Cost factor comes from configuration.

**What it costs.** Measured: ~50–60ms per hash, ~55ms per comparison, so a login
costs the same as a signup. Ten concurrent hashes take 538ms, 10.4× a single hash
— they do not overlap at all. The async API yields the event loop exactly once,
against 45 yields for genuinely interleaving work over the same duration. So
roughly 20 logins per second per process, during which nothing else in the process
runs. This compounds R6.

**How you would trigger it.** Issue twenty concurrent login requests and time an
unrelated endpoint. It waits.

**What closes it.** Move hashing to a worker thread, or use native `bcrypt`,
which releases the libuv thread pool and genuinely parallelises. Native `bcrypt`
was rejected here specifically because compilation failing on a reviewer's machine
is a worse outcome than 50ms; that reasoning does not survive contact with
production. Note also that `hashSync` is four characters from the async call,
appears in most examples, and yields zero times — using the async API is a
decision here, not a default.

---

## R11 — Two-decimal-place validation is asserted in two places

**Chosen.** Both mechanisms, deliberately. A custom Ajv keyword, `currencyScale: 2`,
validates the constraint declaratively at ingress and produces the spec-shaped
`details` entry the 400 response requires. A single boundary function, `toPennies`,
performs the only decimal-to-integer conversion in the codebase and re-checks the same
property, so conversion cannot happen without validation. The service keeps
`toPennies`' rejection branch behind the keyword as belt-and-braces.

**What it costs.** A registration-ordering dependency: the keyword must be registered on
the Ajv instance before any module-level schema constant compiles.

**Corrected once it was built.** This entry previously said the two mechanisms could
drift, because the property was stated twice. They cannot: both call one exported
predicate, `isWithinScale`, so the property is *asserted* in two places and *implemented*
in one. Changing the tolerance changes both. What survives is the ordering dependency
below, which is the real cost.

**How you would trigger it.** Register the keyword late — in a test file rather than
beside the Ajv instance — and the production path throws
`strict mode: unknown keyword: "currencyScale"` at startup.

**Why both, rather than one.** They do different jobs. The keyword is what makes the
constraint visible in the schema, so the JSON Schema remains a complete description of
what the endpoint accepts; the function is what makes it structurally impossible to
convert an unvalidated amount. Dropping the keyword leaves the schema describing less
than the endpoint enforces. Dropping the function leaves conversion as a separate step
that a future call site could perform without validating first. Two assertions of one
property is the price, and it is a smaller price than either omission.

**Why the ordering dependency is acceptable.** `strict: true` refuses to compile a
schema containing an unknown keyword, so a missing registration is a loud startup
throw rather than silent acceptance of three-decimal amounts. That is the good failure
mode, and there is a test asserting it. The registration sits beside the Ajv instance
with a comment recording the exact error text.

**Worth recording what was rejected outright.** The obvious check,
`Number.isInteger(amount * 100)`, is wrong for **131,256 of the 1,000,001** legal
amounts in range — 13.1% — and is nastily wrong, because the values anyone would
spot-check pass: `10.99 * 100 === 1099` while `0.29 * 100 === 28.999999999999996`.
`multipleOf: 0.01` is worse, rejecting 157,274. Both mechanisms here use
round-then-assert-slack, which is exact across all 1,000,001.

---

## R12 — Test-suite database connections scale with the number of test files

**Chosen.** vitest runs with `fileParallelism: false` and `isolate` at its default
`true`, so files execute in sequence but each in a fresh process.

**What it costs.** Each test file constructs its own connection pool rather than
sharing one, so per-file setup cost and total connections scale with file count.
At the current size this is immaterial — the suite completes in a few seconds.

**How you would trigger it.** Add test files until Postgres refuses connections
(default `max_connections` is 100).

**What closes it.** `isolate: false` collapses the run to a single process and a
single shared pool. Not taken: `isolate: false` leaks module-level state between
test files, which presents as a test that passes alone and fails in the suite, or
the reverse. That is an unmeasurable cost traded against a trivial and measurable
one. If the suite grows enough to matter, take it — and make everything at module
scope deliberate at the same time.

---

## R13 — Handlers cannot stream, set custom headers, or return non-JSON

**Chosen.** All HTTP handlers are wrapped by an adapter and have the shape
`(userId, req) => Promise<Result<Success<T>, DomainError>>`. They never receive
the response object.

**What it costs.** A handler has no way to send a response, so it cannot stream,
cannot set a custom header, and cannot return anything but JSON. Adding any of
those requires a second adapter or an escape hatch.

**How you would trigger it.** Try to add a CSV statement export or a file
download.

**What closes it.** A second adapter for the exceptional cases, or widening
`Success<T>` to carry headers and a content type. Both are straightforward.

**Why the trade is worth it here.** The adapter is the single place in the
codebase where a `Result` is consumed, and it is exhaustive by construction. A
handler that ignores its error channel does not compile, and a handler that drops
its success value does not compile either. The invariant "every `Result` is
handled" is therefore a property of the type system rather than an item on a
review checklist — which matters, because the ESLint plugin that would otherwise
enforce it is unmaintained and flags the idiomatic handler shape. Every API this
service is likely to grow returns JSON.

---

## R14 — TypeScript is pinned one major version behind

**Chosen.** `typescript` is pinned to the 6 line rather than tracking latest.

**What it costs.** No access to the native-port compiler and its build-time
improvements.

**How you would trigger it.** `npm i -D typescript@latest` resolves to 7.x, and
typescript-eslint aborts at startup: it declares `typescript@">=4.8.4 <6.1.0"` and
refuses TS 7 outright rather than warning.

**What closes it.** Waiting for typescript-eslint to support TS 7. Until then,
type-aware lint rules are worth more here than a faster compiler — chiefly
`no-floating-promises`, which is the mechanical owner of an invariant that would
otherwise have none. The failure mode without the pin is quiet: the lint script
exits non-zero from its first run, which in a session hunting real lint errors
reads as noise.

---

## R15 — Concurrency behaviour is asserted by test, not by a formal argument

**Chosen.** The withdrawal's correctness under concurrent access is established by
integration tests against a real Postgres with real concurrent connections: two
£100 withdrawals from £100 yield one success, one 422, a zero balance and exactly
one transaction row; twenty concurrent £10 withdrawals from £100 yield exactly ten
successes.

**What it costs.** Tests demonstrate that the implementation behaves correctly in
the cases tested. They are not a proof, and they are specific to READ COMMITTED on
Postgres. The same code under REPEATABLE READ raises `40001 could not serialize
access` instead of re-evaluating the `WHERE` clause, and would need retry logic
that does not exist here.

**How you would trigger it.** Change the isolation level, or move to a database
whose READ COMMITTED does not re-evaluate predicates after a blocking transaction
commits.

**What closes it.** Pinning the isolation level explicitly at the connection or
transaction level rather than relying on the server default, and adding retry
handling for `40001` so the behaviour degrades correctly if the level changes.
Perhaps thirty minutes, and it is the right thing to do before this code runs
anywhere with a non-default configuration.

---

## R16 — Nothing forces a new boundary to use the validation funnel

**Chosen.** All ingress and egress validation passes through one module,
`validatorFor`, which derives the validated type from the schema argument so there
is no second position in which to state the shape differently.

**What it costs.** The funnel protects the calls that happen. It cannot protect a
boundary that never calls it. Adding an ingress point that types its input with `as`
instead of validating it compiles cleanly, passes its tests, and silently opts out
of unknown-key rejection — the mass-assignment hole reopening by omission rather
than by mistake. This is the one failure mode the inferring signature is
structurally unable to close, because it is a property of code that is absent.

**How you would trigger it.** Add a handler that casts `req.body` to a declared
type. Nothing objects.

**What partly covers it today, and it is worth being precise about the difference.**
Three of the four ingress points are validated: request bodies and the decoded JWT
go through the funnel, and every success body is checked on the way out. The fourth
— database rows — is trusted on the strength of Kysely's declared column types. That
trust has a backstop rather than a check: if a row carries something that violates
the published response schema, egress validation catches it at the boundary. A
backstop catches the consequence, not the cause, and only for data that reaches a
response.

**What closes it.** A lint rule requiring a validation step immediately after each
ingress point. My own projects have one, scoped to outbound `fetch` response
proxies; the specific trigger does not arise here because this service makes no
outbound calls, but the general property is the missing one. Not ported — see the
note below.

**A note on the companion tooling, because its absence is smaller than it looks.**
The reference implementation of this helper travels with five pieces of supporting
tooling. Three of them do not apply to the design used here: a rule forcing the
asserted type and the runtime schema to name the same binding (unnecessary — the
type is inferred, so there is only one binding), a rule pinning the helper's export
name so the first rule cannot be defeated by a rename (a meta-rule protecting a rule
that no longer exists), and naming conventions tying filename to schema to validator
to type (which were correctness infrastructure there and are legibility convention
here). The remaining two are real: the call-site rule above, and ahead-of-time
validator compilation, which is R26.

---

## R17 — A `Result` created and dropped inside a service has no mechanical check

**Chosen.** At the HTTP boundary, the handler adapter makes an unhandled `Result` a
compile error: handlers never receive the response object, so returning the
`Result` is the only thing they can do with it, and the adapter's `.match()` is the
single, provably exhaustive place one is consumed. Inside a service, a `Result`
that is created, never inspected and never returned is not caught by anything.

**What it costs.** A failure can be silently discarded in service code. The async
subset is covered by `@typescript-eslint/no-floating-promises`; the synchronous
subset is covered only by review.

**What partly mitigates it, and precisely how far.** The `Rz`/`RzA` naming convention
(`docs/conventions.md`) puts the `Result`-ness of every binding in its name, so a
created-and-dropped `signupRz` is a *legible* unhandled failure where a dropped `result`
is not. Since `local/result-binding-must-have-rz-suffix` was added, that naming is
mechanically enforced rather than reviewed — but **the enforcement is of the naming, not
of the handling, and this risk is untouched by it.** The rule visits bindings and
parameters; a `Result` that is created and discarded has no binding for it to visit. It
makes the reviewer this risk depends on more effective. It does not stand in for them.

The bound-and-never-read case is in fact already covered, and not by either of the above:
`@typescript-eslint/no-unused-vars` reports it. **The uncovered case is narrower than this
entry's title suggests** — it is a `Result` returned by a call in statement position and
never bound at all, where no rule currently looks.

**How you would trigger it.** Call something returning a `Result` in a service
method and ignore the return value. It compiles and lints clean.

**What closes it.** `eslint-plugin-neverthrow` would nominally do this and was
rejected — on dependency health, not on style: last published 2022-05, requires a
hand-rolled flat-config shim for ESLint 9, and this project is on ESLint 10. It
also has no concept of `isOk`/`isErr` narrowing, so it only recognises
`.match()`, `unwrapOr` and `_unsafeUnwrap` as handling. A custom typescript-eslint
rule is the better answer: perhaps forty lines against the type checker, it
understands narrowing, and the type-aware lint infrastructure it needs already
exists here — which is the reason `typescript` is pinned to the 6 line (R14). Not
built inside the budget; sized rather than hand-waved.

**That estimate is now better than a guess.** `local/result-binding-must-have-rz-suffix`
is a working type-aware custom rule in this repository, so the harness question — can a
local rule read the type checker here, and can it be tested — is answered rather than
assumed. What remains for *this* rule is the part that was always the real work:
deciding what counts as handling, given that `isOk`/`isErr` narrowing must count and
`eslint-plugin-neverthrow` did not recognise it.

---

## R18 — The reviewer needs pnpm, and the build-script allowlist must be committed

> **Corrected during the build, at slice 0a.** The trigger below overstated the
> hazard for this dependency set. Measurement and reasoning in
> `docs/divergences.md`; the original claim is struck through rather than deleted,
> because it was load-bearing for the ordering of step 0.

**Chosen.** pnpm as the package manager, with `packageManager: "pnpm@11.18.0"` in
`package.json` — an exact version, not the `11.x` range originally specified, because
corepack resolves a range against the registry per invocation and two machines can
then land on different pnpm 11 minors — and `allowBuilds` in `pnpm-workspace.yaml`,
both committed.

**What it costs.** A reviewer whose machine has no `pnpm` needs `corepack enable`
or a global install — one more prerequisite than `npm` would have been, and
corepack's long-term place in Node core is unsettled. The choice buys something
real in exchange: pnpm's symlinked layout makes an undeclared transitive
dependency fail rather than resolve silently through flat hoisting.

**How you would trigger it.** Clone on a machine without pnpm and run the README's
install command.

~~More sharply: omit `pnpm-workspace.yaml` from the commit and pnpm 11's build-script
gate fails *every* script invocation, not just install.~~ **Not true as built.** No
package in this tree declares an install script — vitest 4 transforms via rolldown
rather than esbuild, and both dependencies that might have needed native compilation
are chosen to avoid it. So `allowBuilds` is empty and omitting the file would cost the
reviewer nothing today.

The gate itself is real, and was verified here on pnpm 11.18.0 with a throwaway
dependency carrying a `postinstall` script: unlisted, it failed `test`, `typecheck`
and `lint` identically inside `runDepsStatusCheck`, with nothing in the trace naming
the cause. So the trigger is **adding a dependency with a build script**, not omitting
the file — and the presenting symptom really is "the toolchain is broken" rather than
"a postinstall script was skipped". The file is committed so that the day this
happens, the fix is one line in a place that already explains itself.

**Confirmed at slice 0e, on a real dependency rather than a throwaway one, with one
detail worse than described above.** Installing `tsx` — since evaluated and declined —
brought esbuild and armed the gate exactly as predicted. But `pnpm add` does not leave
`allowBuilds` alone: it rewrote the entry to
`allowBuilds: { esbuild: set this to true or false }`, an unresolved placeholder rather
than a decision, and it is that write which breaks every script. So the fix is one line,
but the trigger edits the file for you and leaves it in a state where the *only* signal is
three commands failing inside `runDepsStatusCheck`.

**What closes it.** Both prerequisites are in the README, and the cold-start
rehearsal before submission exists specifically to prove the reviewer's path
works. Nothing further is needed unless pnpm's own configuration keys move again —
which they did between 10 and 11, and which is why the tool version is pinned
rather than left to whatever the reviewer has.

---

## R19 — A schema missing `as const` degrades its validated type to `unknown` silently

**Chosen.** `validatorFor<S extends object>` infers the validated body type from
the schema argument, so there is no explicit type parameter anywhere and a
mismatched assertion is unrepresentable.

**What it costs.** The inference depends on the schema being `as const`. Without it
the literal types widen, `FromSchema` has nothing to work from, and the validated
body becomes `unknown` — **silently.** There is no error. Runtime validation still
works perfectly; only the compile-time half quietly stops existing, which is the
worse half to lose because it is the half nothing else covers.

**How you would trigger it.** Add a schema without `as const`, or hoist an inline
schema and forget it. This is not hypothetical: the first attempt at this signature
hit it on exactly two un-`as const`ed inline route schemas, which is why they are
now named constants with `as const satisfies Record<string, unknown>`.

**What closes it.** A type-level test asserting that no validated body type is
`unknown`. Cheap, and it is the only thing standing where the compiler will not —
which is why it is a section 3 invariant of the build brief rather than a
nice-to-have. Note the specific spelling:
`as const satisfies Record<string, unknown>`, not `satisfies JSONSchema`, because
the latter rejects the custom `currencyScale` keyword.

---

## R20 — The validation inference depends on one pinned TypeScript version

**Chosen.** `typescript` is pinned to the 6 line. The inferring signature was
verified at 6.0.3 with json-schema-to-ts 3.1.1 and ajv 8.20.0: project-wide
`tsc --noEmit` clean, no TS2589 or TS2590, typecheck wall time unchanged.

**What it costs.** The result depends on compiler internals — specifically on
constraining the type parameter to `object` so there is no `JSONSchema` union to
distribute an unresolved `FromSchema<S>` across. A future TypeScript could
reintroduce the blowup. The pin is therefore load-bearing for two independent
reasons: type-aware lint rules (R14) and this inference.

**How you would trigger it.** Upgrade TypeScript. If TS2589 or TS2590 reappears at
the validation module, this is what happened.

**What closes it.** The fallback is written down rather than improvised: retreat to
`validatorFor<FromSchema<typeof createUserSchema>>(createUserSchema)`, which also
compiles cleanly. It does not make a mismatched assertion a type error, so it is a
genuine regression in guarantee — but it keeps the type textually adjacent to the
schema it derives from, which is most of the legibility benefit. Knowing which
property is lost is the point of writing the retreat down in advance.

---

## R21 — Errors log at construction, which is not the same as at occurrence

**Chosen.** The seven error constructors log at the moment an error is built. They
were already the single chokepoint through which every error in the service is
born, so no call site has to remember to log and no error can exist unlogged.

**What it costs.** Code that constructs an error and then discards it produces a
log record for a non-event. The guarantee is "nothing unlogged", not "nothing
spurious".

**How you would trigger it.** Build an error, inspect it, and take a different
branch without returning it. Nothing does this today — every constructor call site
returns its error immediately — but it is a real constraint on future code rather
than an accident.

**What closes it.** Nothing cheaply, and that is the honest answer: logging at the
render boundary instead would fix it and would lose the guarantee, since errors
that never reach the renderer would then go unlogged. This is a trade rather than a
defect, and the constraint it imposes on future code is worth stating in the ADR so
the next person meets it as a rule rather than as a surprise.

---

## R22 — Correlation ids are not accepted from upstream callers

**Chosen.** The id is always minted locally, once per request, and an inbound
`x-correlation-id` header is ignored. It is echoed on the response and included in
the error envelope so a user can quote it in a support request.

**What it costs.** In a distributed system this breaks trace stitching across
service boundaries: a downstream call cannot be correlated with the upstream request
that caused it.

**How you would trigger it.** Send `x-correlation-id` and observe that the response
carries a different value.

**What closes it.** Accepting a well-formed inbound id from an allowlist of trusted
callers. Deliberately not the default: a client-controlled correlation id lets a
caller collide with — or deliberately poison — another request's log correlation,
and there is no upstream here to stitch to. Trusting the header would be a security
decision taken for a benefit this service cannot yet collect.

---

## R23 — Every response body is serialised twice

**Chosen.** Egress validation runs on the serialised form,
`JSON.parse(JSON.stringify(body))`, rather than on the in-memory object.

**What it costs.** A full extra serialise-and-parse per successful response.

**How you would trigger it.** Any successful request. It is not conditional.

**What closes it.** Two options, and the second is better. Gate egress validation
to non-production, which keeps the guarantee where it is cheap and drops it where
it costs — the gate is worth deciding once rather than discovering under load.
Or map to a plain response object with timestamps already formatted as strings and
validate that, which removes the round trip and is better design anyway.

**Why the round trip is not optional as things stand.** Ajv's type checks are
`typeof`-based, so a `Date` satisfies `type: 'object'` but fails
`type: 'string', format: 'date-time'`, and a database row can carry `undefined`
values and class instances that `JSON.stringify` silently drops or transforms.
Validating the in-memory object would check something the client never receives.
The round trip also closes the symbol-key hole for free, since `JSON.stringify`
drops symbol-keyed properties and Ajv's `additionalProperties: false` cannot see
them.

---

## R24 — The payload-logging ban guards one key name, and one constructor is exempt

**Chosen.** Request bodies are never logged, and this is enforced by the type
system rather than by memory: the log-only parameter is declared
`PayloadForbidden = LogFields & { readonly payload?: never }` on every error
constructor a client's input can reach, so re-adding a payload is a compile error.
Verified in both directions in `src/domain/errors.type-assertions.ts`, which fails
the build if either the ban or the exception stops behaving. The asymmetry is
carried by which constructor a call site reaches for — ingress failures go through
`validationFailed` and cannot carry a payload; egress failures go through
`unexpected` and can, because that body is the service's own output.

**What it costs, measured rather than described.** The guard is a denylist of one key
name, so it stops the defect it was written for and nothing adjacent to it:

| What a call site writes | Result |
|---|---|
| `{ payload: body }` | rejected |
| `{ payload: body }` via a variable | rejected |
| `{ body: body }` | **compiles** |
| `{ requestBody: … }`, `{ data: … }`, `{ input: … }` | **compiles** |
| `{ ...body }` | **compiles** |

The spread is the worst case, because every field of the body arrives under its own
name. All three accepting rows are pinned in `src/domain/errors.type-assertions.ts`, so
the boundary is recorded rather than rediscovered.

Separately, `unexpected` has to permit a payload for the egress case and is
simultaneously the generic translation target for any thrown error, so even the one
guarded key is unguarded there.

**What this means for the section 3 invariant.** "No credential and no request-body
value ever reaches a log record" is listed as mechanised. It holds today, but what
makes it hold is not this type — it is that the constructors compose their own log
fields from Ajv's error metadata, which is names without values, and that no call site
passes a body. The type mechanises the *regression*, not the invariant.

**How you would trigger it.** Log a request body under any key other than `payload`, or
spread it. Or catch a throw with a client body in scope and pass it to `unexpected`.

**What closes it.** An allowlist of loggable fields — a closed set of permitted key
names with narrow value types, and no index signature — at which point
`PayloadForbidden` is deleted rather than extended, and the asymmetry above is expressed
as a widened allowlist for `unexpected` rather than as an exemption.

**Its cost was overestimated when it was deferred.** The design called an allowlist "a
larger piece of work"; measured against the same five cases it rejects all three
accepting rows, accepts what is meant to go, and is a net deletion of about fifteen
lines. One hole survives it: a *variable* mixing a permitted key with a forbidden one
passes, because excess-property checking only fires on fresh object literals. So it is a
large improvement rather than a closure, which is part of why it was still not taken —
that, and it lands in the middle of a slice under review. It is the next thing to do
here.

---

## R25 — Log record values can be attacker-controlled, via any rejected field name

**Chosen.** In place of the request body, validation failures log `invalidFields` —
the field names Ajv reported, without values and without recursion.

**Corrected once it was built.** This entry was written from the design and named the
wrong route. It said the exposure arrives with the JWT payload path, via
`Object.keys(body)`. Neither half holds: the field names come from Ajv's own error
objects rather than from the body's keys, and the exposure is **live today** rather
than pending, because Ajv names the offending property when an unknown key is
rejected. A request carrying `{"<script>": 1}` puts that string into a log record now.
The same names already reach the client in `details[].field`, which is what makes this
a logging concern rather than a disclosure one.

**What it costs.** Arbitrary attacker-chosen strings appear as *values* in a log
record. No request values are exposed and nothing is forged, because the sink emits
JSON and `JSON.stringify` escapes them.

**How you would trigger it.** Post a body whose unknown key is chosen to look like a
log field, and read the record for the resulting validation failure.

**What closes it.** Nothing is needed while the sink emits JSON. It becomes a real
log-injection vector the moment the sink is line-oriented plaintext — which a
production build swapping this deliberately tiny logger for pino would not
introduce, but a quick debug change might. The durable fix is to cap and allowlist
logged key names rather than to pass them through, and the reason to record it is
that the risk is a property of the *sink*, not of this code, so it will not be
visible from here when it changes.

---

## R26 — Validators compile at module load, not ahead of time

**Chosen.** Each schema is compiled once by Ajv at module load, at
route-registration time, and the helper is a factory: it takes a schema and returns
the validating function.

**What it costs.** Three things, the first two of which this service does not
currently need — which is why the choice is defensible rather than merely convenient.

- **Startup work.** Ajv compilation is not free and it happens on every process
  start. Immaterial for a long-running server; it is not immaterial for a function
  that cold-starts per request.
- **Runtime code generation.** Ajv compiles schemas by generating and evaluating
  code. That is unavailable under a strict Content Security Policy, on runtimes that
  forbid `unsafe-eval`, and in some edge and serverless environments.
- **A hardening measure is foreclosed, and this half is security rather than
  deployability.** Because Ajv needs dynamic evaluation, this process can never run
  with it switched off. Verified: under
  `node --disallow-code-generation-from-strings`, `ajv.compile` throws
  `EvalError: Code generation from strings disallowed for this context`. So if any
  dependency ever turned attacker-supplied data into a string reaching `eval`, that
  flag could not be used to mitigate it.

**Being precise about what this is not, because the stronger conclusion is the
tempting one.** It is not an injection path. Ajv's `new Function`
(`ajv/dist/compile/index.js:89`) is handed source generated from the **schema**, never
from the data. Every schema here is a hand-written module constant, and a request body
is only ever an argument to an already-compiled function — so an attacker cannot cause
code to be generated, and precompiling would not close a hole, because there is not
one. What it removes is defence in depth, not an exploit.

Two facts that bound it. Compilation happens at **module load**, so the evaluation
surface is closed before the first request is served rather than being reopened per
request. And precompilation moves it to build time entirely, which is what would let
the flag be set.

**How you would trigger it.** Deploy this service somewhere that forbids runtime
code generation, or start it with dynamic evaluation disabled. Validation fails at
startup rather than degrading — loudly, which is the better of the two failure modes
available.

**What closes it.** Ajv's standalone code generation, run as a build step that walks
the schema modules and emits precompiled validator files. The reference
implementation of this helper does exactly that, which is why its signature takes a
compiled `ValidateFunction` rather than a schema — and why it is a direct call rather
than a factory, since compilation has already happened by then.

**The trade worth being able to state, because it is the interesting half.**
Ahead-of-time compilation separates the schema (a compile-time artefact) from the
validator (a runtime one), and that split severs the type-level relationship between
the asserted type and the thing performing the validation. Restoring it needs
convention: a lint rule forcing both to name the same schema, naming rules making the
bindings mechanically derivable, and a further rule stopping a rename from defeating
the first. Three rules are the price of the capability. Declining the capability
collapses them, because passing the schema directly makes the relationship inferable
and therefore unbreakable. Neither design dominates: one buys deployability with
convention, the other buys a compile-time guarantee by giving up deployability it does
not currently need.

**Note on the name, and a decision reversed.** The helper was called `isJsonValidRz`,
which read like a predicate while behaving like a factory. The mismatch was inherited
rather than chosen: the name belongs to a reference implementation where validators are
precompiled, so a direct predicate-shaped call is the natural form *there*. It was kept
deliberately, so that the code and the design conversation used the same word.

**That has been withdrawn; it is now `validatorFor`.** The shared vocabulary was worth
less than it cost, and there were two defects rather than the one originally noticed.

The recognised one: a reader meeting a function named `is…` reasonably expects a boolean
or a type predicate and gets neither — it returns a function.

The more serious one, visible only once the `Rz` convention was written down in
`docs/conventions.md`: a bare `Rz` asserts that the thing **is** a `Result`, and a
function that merely returns one takes an underscore (`get_appIdRz`). This helper is two
steps from a `Result` — it returns a function, and only that function returns one — so
the suffix was wrong by two levels of indirection rather than being harmless decoration.
It would have been wrong in the reference implementation too, where the correct spelling
for a direct call is `isJsonValid_Rz`. `validatorFor(schema)` carries no marker because
no marker applies to a factory; call sites read

```ts
const validate_signupRz = validatorFor(signupSchema)   // returns a Result
const signupRz = validate_signupRz(req.body)           // IS a Result
```

**What this costs, stated because it is the argument that was being made.** The design
conversation and the code no longer share a word, so anyone reading both has to carry
the mapping. That is a real cost and it is why the old name survived this long; it is
paid once by a reader of this note, whereas the predicate/factory mismatch was paid by
every reader of every call site. Note also that if this risk is ever closed —
ahead-of-time compilation, a direct call taking a compiled `ValidateFunction` — a
predicate name becomes correct again — as `isJsonValid_Rz`, not the original spelling —
and the rename back should ride along with the signature change rather than being argued
separately.

---

## R27 — The commit gate is local, opt-in per clone, and checks the working tree

**Chosen.** Two committed git hooks under `.githooks`, activated by
`git config core.hooksPath .githooks`. `pre-commit` runs typecheck, lint and the
full suite; `commit-msg` rejects a message containing any phrase that identifies
the origin of this work. Native hooks rather than husky: husky's value is
automatic setup across a team, there is no team, and its cost is a `prepare`
lifecycle script in the reviewer's `pnpm install --frozen-lockfile` — the one path
that forms their first impression.

Verified in both directions rather than assumed. `pre-commit` was shown to block a
type error, a failing test and a lint error independently; `commit-msg` was shown
to reject five identifying messages and accept four legitimate ones, to skip
generated merge and revert messages, and — the case that matters — to ignore the
staged diff that `commit.verbose` appends as comments, which contains the forbidden
phrases legitimately because `openapi.yaml` is a supplied input committed unaltered.

**What it costs.** Four gaps, in ascending order of how much they matter.

- **Opt-in.** `core.hooksPath` is local configuration, so a fresh clone has no
  hooks until someone runs the command. The gate protects this machine, not the
  repository.
- **The gate can be present and inert, which is worse than absent.** This
  devcontainer sets `core.fileMode = false`, so git ignores the on-disk executable
  bit and a hook committed from here lands as `100644` however it was `chmod`ed. Git
  then *silently skips* a non-executable hook — no warning, no error. A clone can
  therefore have `.githooks` present, `core.hooksPath` set correctly, and no gate at
  all. Unlike being opt-in, where nothing appears to run, here everything appears
  installed. This is not specific to hooks: it applies to every executable this
  repository will ever commit, a CI script or a container helper included.
- **Working tree, not staged content.** The hook runs the gate over the working
  tree. Staging a subset and committing can therefore record a green commit whose
  own tree does not build.
- **The denylist fails open.** A phrase not on the list passes. This is the right
  tool anyway, because the thing guarded against is not an adversary choosing new
  words — it is an author writing from a source document saturated in them — but it
  is a fence, not a proof.

**How you would trigger it.** Clone fresh, skip the config line, and commit
anything: nothing runs. Or `git add` one file of several, break another, and
commit: the gate passes on the working tree while the committed tree does not
build. Or write a message naming the exercise in words the list does not carry.

Or — the one that has actually happened — add an executable to `.githooks`, `chmod
+x` it, commit, and clone: the file arrives without the bit and is skipped in
silence. Caught here only by cold-cloning to check, which is why that check is worth
doing rather than assuming. The fix is `git update-index --chmod=+x <path>`, and
`git ls-files -s` is what confirms it: the mode must read `100755`, not `100644`.

**What closes it.** CI, which §13 already calls for: `pnpm install
--frozen-lockfile` then typecheck, lint and test against the pushed tree. That
closes the first two gaps properly rather than approximately — it is not opt-in and
it tests exactly what was committed. The hooks are the fast local echo of it, not a
substitute. Checking staged content locally would mean stashing the remainder,
which buys a case this workflow does not produce (slices are committed whole) at
the price of a way to lose work. The README must carry the `core.hooksPath` line in
its prerequisites, or the gate silently does not exist for anyone else.

---

## R28 — The Result naming rule sees bindings, not every position a `Result` can occupy

**Chosen.** `local/result-binding-must-have-rz-suffix` enforces `docs/conventions.md`
mechanically, and does it type-aware rather than by name heuristics: the binding's
resolved type is the whole classification, so factories, combinator chains and
annotations are all handled without a producer list to maintain.

**What it costs.** Three gaps, each deliberate and each an argument for review rather
than a hole in the rule's logic.

- **The producer half of the convention is unenforceable this way.** `getAppIdRz` — a
  function returning a `Result`, spelled without the `_` — passes. The underscore is a
  claim about a function's *return* type; the rule reads the type of the binding. A
  second rule could check the return type of every declaration, and would have to decide
  whether an unbound arrow passed inline counts. Not attempted.
- **Only `let`/`const` bindings and function parameters are visited.** Class properties
  and object literal members are not. Nothing in the codebase has a `Result`-typed
  property yet; services and repositories will, and that is when this gap becomes live
  rather than theoretical.
- **Destructuring is out of scope**, because attribution to a single `Result` is
  unclear — `const { a } = someRz` does not obviously make `a` anything.

**A second cost, of a different kind: the rule itself is not typechecked.**
`eslint.config.mjs` has to import it, and an `eslint.config.ts` requires `jiti` — the
dependency that file's own comment declines. So the rule is `.mjs`, outside `tsc`'s
reach, and `pnpm lint` covers it syntactically only. That is the reason its 22 test cases
are the thorough half of the work rather than a formality: they are the only thing
standing where the compiler does not, which is the same argument as
`validator-for.type-assertions.ts`.

**How you would trigger it.** Add a service with a `Result`-typed private field named
without a suffix. It compiles, lints clean, and the convention is silently not applied
to it.

**What closes it.** Visiting `PropertyDefinition` and `Property` nodes as well — a small
extension to the existing `check` function rather than a new rule, since the
classification logic is already position-independent. Worth doing when the first
`Result`-typed property exists, and not before, so the extension is written against a
real case.

**Note that it fails loudly rather than silently.** The rule throws if handed a file with
no type information instead of degrading to no-op. That is why it is registered against
`**/*.ts` specifically: a global registration would abort on `eslint.config.mjs` itself.
If a future glob is added without `projectService` coverage, `pnpm lint` breaks rather
than quietly stopping enforcement — the correct direction for a rule whose whole value is
that it is running.

---

## R29 — `allErrors: true` makes validation effort scale with how invalid a body is

**Chosen.** Ajv runs with `allErrors: true`, so validation does not stop at the first
violation. The specification's 400 response requires a `details` array naming every
offending field, and a validator that fails fast cannot produce one.

**What it costs.** Ajv's own security guidance names this option as a
denial-of-service consideration, and the reasoning is sound: without fail-fast, a
hostile request maximises work rather than minimising it, because every additional
violation is another error object constructed and retained. Effort scales with how
invalid the body is, which is entirely under the caller's control.

**How you would trigger it.** Post a body composed to violate as many keywords as
possible — a few thousand unknown keys against a schema with
`additionalProperties: false` — and every one is collected rather than the first
ending the check. Repeat concurrently.

**What bounded it when this entry was written.** The request body size limit,
**inherited rather than chosen**: `express.json()` defaults to 100kb and nothing set,
asserted or mentioned it. The protection was real but undecided, so a future
`express.json({ limit: '10mb' })` added for an unrelated reason would have widened it
hundredfold with no test objecting.

**Taken, at the error-envelope slice.** The limit is now stated —
`express.json({ limit: '16kb' })` in the composition root — and an oversized body is
asserted to be rejected rather than parsed. One difference from the closure proposed
here: it is rejected with **400, not 413**, because the specification publishes no 413
and the envelope is the same one every other client error renders through. The
`details` entry names the limit as the offending constraint.

**What remains.** Only the heavier alternative — validating fail-fast and re-running
with `allErrors` purely to build the response body — which trades a second validation
pass on every failure for a guarantee that the size limit already provides at this
scale. Not worth it.

**Not to be confused with R26.** That entry is about Ajv generating code from
*schemas*; this one is about Ajv doing unbounded work on *data*. Different mechanism,
different fix, and precompilation does nothing for this one.

---

## R30 — The published request schemas describe something looser than the service enforces

**Chosen.** `additionalProperties: false` was added to the published *response* schemas
and deliberately not to the published *request* schemas, although every ingress in this
service rejects unknown properties. The word appears nowhere in the supplied
specification — verified by parsing it — so both halves would have been additions, and
only one was taken.

The division is by who bears the consequence. Closing a response schema documents a
guarantee this service makes, and costs a client nothing. Closing a request schema
imposes a new restriction on callers: a body legal under the document as published starts
returning `400`.

**What it costs.** The specification under-describes the endpoint. A reader of
`CreateUserRequest` cannot tell that `{ …, "isAdmin": true }` will be rejected, because
nothing in the published schema says so. That is exactly the criticism this project makes
of publishing a schema looser than the behaviour behind it — the same objection R11
raises about omitting the two-decimal-place keyword — so it is inconsistent to record
that one and not this.

**How you would trigger it.** Generate a client from `openapi.yaml`, send a request body
carrying any property the schema does not name, and receive a `400` the generated client
had no way to anticipate. Round-tripping is worse than a plain mistake here: a client
generated from the document produces requests the document permits and the service
refuses.

**What closes it.** Add `additionalProperties: false` to `CreateUserRequest`,
`UpdateUserRequest`, `CreateBankAccountRequest`, `UpdateBankAccountRequest`,
`CreateTransactionRequest` and `LoginRequest`, including the nested `address` objects,
and record it in `docs/spec-changes.md` as a contract tightening rather than a
correction. Ten minutes of editing.

**Why it was not simply taken.** Tightening a contract on someone else's published
document is a different act from fixing a defect in it. Every other edit in
`docs/spec-changes.md` either unblocks the build, repairs something demonstrably broken,
or documents a guarantee. This one would narrow what callers may send, and it is the only
edit on the list that could break a conforming client. That is a decision to raise rather
than to make silently — which is the whole reason this entry exists instead of the edit.

---

## R31 — The test suite resets once per run, not between test files or tests

**Chosen.** `test/db/global-setup.ts` drops and recreates the `public` schema, then
migrates, once per run in the main vitest process. There is no truncation between test
files and none between individual tests.

**What it costs.** Test files share one schema and one set of rows, so writes made by one
are visible to another. The starting state is guaranteed for the *run*, not for any file
within it. Order-dependence becomes possible: a file can pass alone and fail in the suite,
which is the same class of defect that `isolate: false` was declined for in R12 — so
accepting it here is the narrower version of a cost already refused once.

Nothing suffers from it today, because exactly one file touches the database and it asserts
its own empty starting state.

**How you would trigger it.** Add a second test file that inserts into a table a first file
reads, then run the suite. `fileParallelism: false` means the two will not interleave, so
the symptom is not a race — it is the second file finding rows it did not create, and the
failure names a row count rather than the missing isolation.

**What closes it.** A `truncate table … restart identity cascade` in a `beforeEach`, which
is the shape the reference implementation already has. `cascade` is required because
`transactions` references `accounts` references `users` — without it Postgres refuses,
naming a table the statement did not mention. `restart identity` keeps ids from drifting
between tests. It is a few minutes of work and it belongs with step 2, which is where the
first real table and the second database-touching test file both arrive. Deferred rather
than built because there is currently nothing to truncate, and a `beforeEach` naming tables
that do not exist would not compile.

---

## R32 — Local development credentials are committed in `compose.yml`

**Chosen.** `compose.yml` sets `POSTGRES_USER: ledger` and `POSTGRES_PASSWORD: ledger`,
and the matching connection strings are defaults in `src/db/connection.ts`. Both are
committed to a public repository.

**What it costs.** It is in tension with the §3 invariant "no signing key, secret or
credential committed", and a reader scanning for that invariant will find these and have
to decide for themselves that they do not count. They do not: the port is bound to
`127.0.0.1`, the values grant nothing beyond a developer machine, and a deployed process is
handed a whole connection string in `DATABASE_URL` and never assembles one from these
parts. But "it is fine, and here is why" is a judgement the repository should state rather
than leave to be re-derived.

**That first clause was false when this entry was written, and the code was changed to make
it true.** The entry claimed loopback publication while `compose.yml` said `55432:5432`,
which binds `0.0.0.0` — so a database holding committed credentials was reachable on every
interface the machine had. The argument for committing the credentials depended on a
property the configuration did not have. It now reads `127.0.0.1:55432:5432`.

The real cost is precedent. A committed credential that is genuinely harmless normalises
the shape, and the next one may not be — particularly the JWT signing key, which is the
same kind of string in the same kind of file and is deliberately not treated the same way.

**How the signing key differs, decided rather than deferred.** It is generated once per
process with `randomBytes`, and there is no environment variable, no default and no
committed fallback. A fresh clone therefore works with nothing configured, and §3's "no
signing key, secret or credential committed" is satisfied by there being nothing to
commit. The cost is that issued tokens do not survive a restart, which is true, stated in
the README, and irrelevant to a service with no deployment.

A deployed service would need the opposite: the key supplied from the environment, shared
across instances, rotatable, and absent at startup treated as a failure to boot rather
than as a reason to generate one. None of that is built, and a `NODE_ENV === 'production'`
branch enforcing it would be a guard for a case that cannot occur in any run this
repository supports.

**How you would trigger it.** Reuse these values anywhere reachable from another host, or
copy the pattern for the signing key at step 3 on the grounds that `compose.yml` already
does it.

**What closes it.** Requiring the values from the environment with no default, which was
declined deliberately: it breaks the cold-start path a reviewer takes, where
`docker compose up -d --wait` followed by `pnpm test` has to work with nothing configured.
A `.env.example` was also declined — it would be a second copy of the same string, free to
drift from the default in code, for no gain over having the default in code. The honest
closure is not to remove these but to make the boundary explicit: the signing key at step 3
is generated per run in development and read from the environment everywhere else, with no
committed fallback, and this entry is the reason that asymmetry exists.

---

## R33 — The log sink has no level threshold, and every error logs

**Chosen.** `log()` writes every record it is given. There is no threshold, no
sampling and no way to raise the floor without changing code, and log-at-construction
means every error that exists produces a record by design.

**What it costs.** Log volume is a function of how badly clients behave, which is not
something this service controls. The 404 fallback is the sharpest case: an unmatched
route is an ordinary client mistake logged at `info`, so anything scanning for
`/wp-admin` writes a record per probe. At real traffic the cost is storage and
ingestion spend rather than correctness, and the records that matter get harder to
find among the ones that do not.

**How you would trigger it.** Point any path scanner at the service, or send a
malformed body in a loop. Both are unauthenticated paths that log before anything
rejects them.

**What closes it.** A level threshold read from the environment, which is four lines
and the conventional shape — `LOG_LEVEL=warn` in production would drop the whole 4xx
stream. It is not built because nothing here consumes it: there is no deployment, no
collector, and no measured volume to tune against, so the threshold would be a
configuration knob whose correct value is unknown and whose behaviour nothing asserts.
The related decision worth naming is that dropping `info` in production also drops the
detail record for every client error, leaving only the outcome record from the
renderer — which is a deliberate trade to make once, not a default to inherit.

**Not to be confused with R21.** That entry is about errors being logged at
construction rather than at occurrence, which is a question of *when* a record is
written. This one is about how many are written and whether anything can turn them
down.


---

## R34 — Two specified list endpoints are not built

**Chosen.** `GET /v1/accounts` and `GET /v1/accounts/{accountNumber}/transactions` are
described in the specification and are not implemented. Create-and-fetch is delivered for
all three resources, along with login.

**Why these two rather than any others.** They are the only endpoints in scope that
introduce no concept the service does not already contain: no new table, no new ownership
rule, no new error status. Both are a query scoped to the authenticated user against a
schema shape that already exists. That makes them the cheapest endpoints to add, which is
the same property that makes them the least informative to have built.

**What it costs.** A client generated from the specification will have two methods that
return 404. The gap is also visible to a reader, who has to decide whether it is staging
or incompleteness.

**How you would trigger it.** Request either path. The 404 fallback answers, correctly but
uninformatively — it does not distinguish "no such route" from "not implemented here".

**What closes it.** For `GET /v1/accounts`: a repository method selecting by `user_id`, a
response schema, a service method, and one line in the composition root. The README
walkthrough uses this exact endpoint as its worked example, so the closure is written out
in full there rather than summarised here. The transaction list is the same shape plus the
pagination decision recorded in R4.

**Why it is answered in the README rather than only here.** A gap a document explains
reads differently from a gap a document omits, and this one is the worked example for the
claim that adding an endpoint requires no new machinery. Recording it only in the risk
catalogue would leave the strongest evidence for that claim filed as a shortcoming.
