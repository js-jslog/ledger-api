# Build brief — Eagle Bank take-home (TypeScript)

**Revision 6.** Supersedes rev 5. Rev 6 folds in the second round of probe work
(commits `aa6ffcc`, `e369d57`, `c2e2aad`), which **overturned `F7`'s conclusion**,
named the validation funnel, and added observability and egress validation. A
credential-logging defect in that work was found and fixed structurally in
`9ccd999` — see section 8b. Rev 5 notes follow.

**Revision 5.** Supersedes rev 3 and rev 4. Rev 4 incorporated the adversarial
probe branch `probe-ledger-api-brief-2nd-run` and its fifteen findings
(`F1`–`F15`), plus an independent re-read of the supplied specification. Rev 5
adds two things rev 4 got wrong or left out:

- **pnpm is the package manager**, by standing preference. Rev 4 substituted npm
  on the strength of `F1`; that argument priced in the cost of _discovering_
  `allowBuilds`, which the probe has already paid. Reversed, and given a proper
  affirmative case in section 4.
- **The probe branch is a named input to the build**, with a pinned commit, a
  consultation protocol, and a stop line on spawning further probes. Section 2a.

Marking convention:

- **[verified]** — established empirically by probing, rev 3 or rev 4.
- **[unverified]** — untested assumption. There are now very few.
- **[F<n>]** — traceable to a numbered probe finding. Where rev 4 _departs_ from
  what the finding recommends, the departure and its reason are stated inline.

**Audience:** the Claude Code session, and me while building. Interview
preparation lives in `advisory-continuity-brief.md` and is deliberately absent.

---

## 0. Doctrine

Three rules govern every judgement call below, in this order.

1. **A submission that generates discussion beats a submission that is
   complete.** Not all endpoints are expected. Depth on the parts that carry
   design content beats breadth.
2. **Where risk exists, take the safe path and record the residual.** A
   deliberately-chosen limitation, written down with its cost and its fix, is a
   stronger artefact than the thing it was traded for. This is what
   `docs/residual-risk-catalogue.md` is for, and it is a first-class deliverable.
3. **Nothing ships that cannot be explained unprompted.** Reading speed, not
   writing speed, is the binding constraint.

Rule 2 is new in rev 4 and it changes several calls that rev 3 got right for
weaker reasons.

---

## 1. Context

A REST API for a fictional retail bank — users, accounts, transactions — built
against a supplied OpenAPI specification and a set of Given/When/Then scenarios.

- **Take-home for a staff engineer role.** AI assistance is permitted and
  expected. A follow-up walkthrough and pair-coding session follows, where every
  line must be defensible.
- **Budget: ~12 hours across three evenings.** The brief explicitly states not
  all endpoints are expected.
- **TypeScript by choice**, against a company whose stack is probably Java/JVM.
  No dependency is inherited by default; each one is a decision.
- **What actually gets assessed:** ownership authorisation, exact money handling,
  atomic writes, append-only transactions, correct unhappy-path status codes —
  then scoping judgement and legibility.

---

## 2. Operating rules for the build session

**The binding constraint is reading speed, not writing speed.** Claude Code can
generate faster than I can absorb. The worst outcome available is shipping code I
cannot explain — worse than shipping less.

1. **Never accept a diff I haven't read closely enough to defend unprompted.** If
   that means fewer endpoints, that is the correct trade.
2. **Work one slice at a time.** Each slice ends with a green test suite and a
   commit. Do not generate multiple endpoints in a single pass.
3. **`typecheck` runs in the same gate as `test`, from step 0.** Not later, not
   optionally. `F7` is a case where every runtime test passes and only `tsc`
   objects — a session that runs tests first will build for an hour on top of
   something that does not compile. Green means both. **[F7]**
4. **Small, coherent commits telling an incremental TDD story.** Do not squash.
   The commit history is an artefact the reviewer will read.
5. **Open the session with sections 3 and 4, not with the spec.** Constraints
   first, scenarios second.
6. **Stop lines are real.** When one is hit, take the documented fallback rather
   than pushing on. Every stop-line trade gets an entry in
   `docs/residual-risk-catalogue.md` at the time it is taken, not retrospectively.

---

## 2a. The probe branch — a named input, and how it may be used

The adversarial probe is a **named input to this build**, not background reading.

```
Repository  https://github.com/js-jslog/ledger-api
Branch      probe-ledger-api-brief-2nd-run
Commit      9ccd999bc5225528eee7998bf3b0fa15b6c6a98d   <- pin this, not the branch
Local ref   origin/probe-ledger-api-brief-2nd-run
            fetched but NOT checked out -- see section 2b
Read it     git show origin/probe-ledger-api-brief-2nd-run:FINDINGS.md
            No network access needed once fetched.

**Verify the pin before starting:** `git rev-parse` the fetched ref and check it
matches the commit above. If it does not, the branch has moved and something in this
brief may describe code that is not at the pinned commit — find out what changed
before diffing against it.

The four commits after 61e7993 are a second round run against the first round's own
output:
  aa6ffcc  Name the validation funnel isJsonValidRz, and bind the type to the schema
  e369d57  Correlation ids and log-at-construction, added to the existing error union
  c2e2aad  Validate responses as well as requests, in the handler adapter
  9ccd999  Stop logging the request payload; it was writing plaintext passwords

**Why the pin rule earned itself.** This block pinned `c2e2aad` for one revision
while section 8b already described the `9ccd999` fix — so the pinned reference still
logged plaintext passwords for every failed signup, and the consult-after-attempt
protocol would have faithfully reproduced the defect into the build. A stale pin is
worse than no pin, because it looks authoritative. Re-pin whenever the branch moves,
and treat a mismatch as a question rather than a formality.
```

A first round exists at `probe-ledger-api-brief`
(`fed160bd3662dc8c08700c4e0172ea4607b3cfb4`) and is superseded. **Cite the commit
rather than the branch**: the branch will move, because the `isJsonValidRz`
verification in section 6b is being added to it.

### Why it is an input

The probe built a working vertical slice of every endpoint section 9 puts in
scope, to this brief's own design decisions, so those decisions could be tested
rather than argued. It is the closest thing available to a validated reference for
this design. Fifteen findings came out of it, and the second round then
**overturned the most severe of them** (`F7`) by finding a working shape the first
round had concluded did not exist — the engine turned on its own output. It is a
reference, not an authority, in both directions: this brief overrules it in one
place (section 4, test isolation) and has been overruled by it in three (sections
6a, 6b and 8c).

### How it may be consulted — this part is binding

The methodology this probe belongs to is _solve the problem, throw it away, and
rebuild with a better understanding of the problem space_. **A build session that
reads `src/` and transcribes has abandoned the methodology and produced a
repository I cannot defend**, which is the worst outcome available under section 2. So the branch is split:

| Path                       | Access                                      | Why                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FINDINGS.md`, `README.md` | **Read freely, first**                      | Evidence. Every claim traces to a probe.                                                                                                                                                         |
| `probe/**`                 | **Read freely**                             | The probe tests _are_ a specification of the required behaviour, including the concurrency figures and the 2dp arithmetic. Reading a test that asserts the right behaviour is not transcription. |
| `src/**`                   | **Consult only after attempting the slice** | Write it, then diff, then account for each difference in one line.                                                                                                                               |

The by-product of that last rule is the artefact worth having: **a running list of
places where the second attempt diverged from the first, and why.** Keep it as
`docs/divergences.md` or as commit-message bodies — either is fine, but keep it.
Divergences where the probe was _better_ are the most valuable entries, not the
least.

### The per-slice loop — the falsification engine in use

The branch is not a reference to be read once at the start. **Every slice in
section 10 closes with a falsification pass**, and the pass is the point of having
the probe at all.

For each slice:

1. **Name the claim, if the slice has one.** Most do: "a zero-row update means
   422", "the error handler receives the error", "`allowBuilds` is what unblocks
   the scripts". If a slice rests on no claim, say so and move on.
2. **Build it without reading `src/`.** The consultation table above is binding.
3. **Check the slice against the findings for that slice** — the matrix below,
   not all fifteen from memory.
4. **Diff against the probe's `src/`.** Account for every difference in one line:
   _deliberate_, _equivalent_, or _I was wrong_. Third category goes in
   `docs/divergences.md`.
5. **Run the probe's own test for that behaviour if it will run**, adapted only at
   the seams. The concurrency figures in section 7 and the 2dp arithmetic in 6a
   are the two where this is worth real effort, because both are assertions about
   the world rather than about an interface.
6. **Anything unresolved becomes a claim or a catalogue entry**, per the stop line
   below.

The engine only earns its budget if it can come back negative. A slice where the
pass finds nothing is a fine outcome; a slice where the pass was skipped is not.

### Findings-to-slice matrix

So the session checks against three or four items per slice rather than trying to
hold fifteen.

| Slice                   | Findings live here                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------ |
| 0a toolchain            | `F1` build-script gate, `F2` TS pin, `F8` `argsIgnorePattern`, `F4` isolation config |
| 0b validation spike     | `F7` — the whole finding                                                             |
| 0c spec edits           | `F13` unsatisfiability, section 6 items 1–4 and 6                                    |
| 0d database             | `F9` stale volume, `F3` DinD                                                         |
| 1 error envelope        | `F5` all six criteria, `F8` again, `F15` adapter, `F6` `toPennies`                   |
| 2 create user           | `F14` bcrypt cost, `F12` triggers, `F7` validator call-site shape                    |
| 3 login                 | `F5` async middleware propagation, JWT payload `additionalProperties`                |
| 4 fetch user — keystone | 403/404 taxonomy; nothing new, everything after copies it                            |
| 5 accounts              | `F11` minting, `CHECK` constraint, `F12`                                             |
| 6 transactions          | **`F10` existence check**, section 6 P7 query scoping                                |
| 7 sad paths             | `F10` concurrency figures as the target to reproduce                                 |
| 8 documentation         | `F13` into `docs/spec-changes.md`, everything into the catalogue                     |
| _cross-cutting_         | `F7` **as amended** (section 6b), observability (8b), egress (8c)                    |

### Spawning further probes — with a stop line

The build session is expected to object to this design. When it does:

1. **Objections about a falsifiable claim** may spawn a probe. Timeboxed at
   **20 minutes**, on a branch, findings written down before returning to the
   build.
2. **Objections about a preference** may not. They go to
   `docs/residual-risk-catalogue.md` and the build continues.
3. **Never during evening 2.** The domain slice is the one thing section 9 says
   is never dropped, and a probe that overruns costs it directly.

The distinction matters because the failure mode of this workflow is a probe that
confirms everything and cost real time. A probe earns its budget by having been
able to come back negative.

---

## 2b. Session bootstrap — what the build session is given

Rule 5 in section 2 ("open with sections 3 and 4, not with the spec") is about
reading _order within this document_. It is not an instruction to withhold
documents. Hand over all of the following at the start.

| Artefact                                     | Why                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This brief**                               | Primary. Read sections 0, 2, 2a, 3, 4 before anything else.                                                                                                                                                                                                                                     |
| **`openapi.yaml`** (supplied, unedited)      | Input to step 0c. Hand over the _original_; the edits are the session's work.                                                                                                                                                                                                                   |
| **The scenario document** (the supplied PDF) | The acceptance criteria, and not a restatement of the spec. Both are needed: the `accountId`/`accountNumber` divergence in section 6 exists only _between_ the two documents, so a session given one cannot see it.                                                                             |
| **`docs/residual-risk-catalogue.md`**        | A living deliverable the session maintains from step 0 onward, not a write-up for evening 3.                                                                                                                                                                                                    |
| ~~The probe branch~~                         | **Not an artefact to hand over.** A git ref is arranged, not passed: section 2a pins the commit and the working-branch block below tells you to fetch it. Once fetched it is in the repository and needs no network access. Do not paste `FINDINGS.md` — it is ~40KB and `git show` reaches it. |

**Withheld: `advisory-continuity-brief.md`.** Deliberate. It exists to prepare a
conversation, and a build session holding it optimises for code that is
_talkable about_ rather than code that is correct — which inverts section 0 rule 3. It also carries employment context and role framing that could surface in
README prose. Everything the build legitimately needs from it is already section
0 rule 3 and section 2 rule 1. If something turns out to be missing, lift that
specific piece into this brief rather than opening the document.

**On reading order — corrected.** Section 2 rule 5 says "open with sections 3 and 4,
not with the spec". That is an argument about **order**, not about a subset: it means
do not let the OpenAPI document drive the design. An earlier version of this section
turned it into a reading list of five sections, which was wrong. The failure modes are
asymmetric — over-reading costs a little attention, while under-reading section 9
means building a deferred endpoint and under-reading section 13 means a secret or an
identifying phrase in a commit. Read all of it.

**Opening instruction to paste alongside the artefacts:**

> **Read this whole brief end to end before proposing anything.** Do not skim and do
> not start work during that pass. The goal is knowing what is in it, and that section
> 0 (doctrine) and section 3 (invariants) govern everything else.
>
> Then re-read sections 0, 2a, 3 and 4 immediately before starting. Those four bind
> continuously; the rest you return to at the point of use.
>
> Sections 6 to 8c are the design content, and each slice depends on specific parts of
> them. Re-read the relevant section at the start of each slice, using the
> findings-to-slice matrix in section 2a to know which.
>
> Four that are easy to skip and expensive to skip: **section 9** is scope, and
> building a deferred endpoint is worse than building nothing; **section 11** is the
> fallback to take at the stop line rather than pushing on; **section 12** means
> evening 3's final 90 minutes are reserved regardless of code state; **section 13**
> governs the repository and commit messages, including no secrets and no phrases
> identifying the exercise.
>
> Where this brief narrates its own revision history — "rev 4 declined X, rev 6
> reverses it" — that record is deliberate and is for my use, not an instruction.
> **Only the current stated position binds.** Section 6a in particular argues against
> the `currencyScale` keyword at length and then reverses. If you cannot tell which
> position is current, ask rather than choosing.
>
> Then start at step 0a of section 10.
>
> The probe branch is fetched but not checked out. Read `FINDINGS.md` and `probe/**`
> freely via `git show`. **Do not read `src/**` until you have attempted the slice
> yourself** — then diff, and account for each difference in one line as deliberate,
> equivalent, or "I was wrong". The third category goes in `docs/divergences.md`.
>
> Work one slice at a time. Each slice ends with a green `test` _and_ `typecheck`, a
> falsification pass against the findings for that slice, and a commit. Do not
> generate more than one slice per pass. Small, coherent commits — do not squash.
>
> `docs/residual-risk-catalogue.md` is pre-populated with intended trades, not with a
> record of this code. Add to it the moment a trade is actually taken, including every
> stop-line decision, at the time rather than retrospectively.
>
> You are expected to object to this design. Objections about falsifiable claims may
> become 20-minute probes on a branch, with findings written down before returning.
> Objections about preferences go in the catalogue and the build continues. Never
> probe during evening 2.
>
> Do not deviate from a section 4 closed decision without saying so, and why, first.

**Where to work.** Start from `main`, not from a branch off the probe branch. If the
probe's `src/` is in the working tree the consultation protocol above is
unenforceable, because reading it becomes the path of least resistance. Make it
reachable but not present:

```
git checkout main && git checkout -b build
git fetch origin probe-ledger-api-brief-2nd-run
```

`main` already carries a devcontainer, a Dockerfile and two container scripts — the
devcontainer needs the `F3` docker-in-docker pin with a comment saying why.

---

## 3. Invariants — session prompt and review checklist

_Double duty: opening context for Claude Code, and a pre-commit review checklist.
These are the properties that tooling cannot mechanically verify. Extract to
`docs/constraints.md` if useful._

- Every handler that resolves a resource by ID checks ownership against the
  authenticated `userId`, in the service layer — not in middleware, not inferred
  from the path parameter.
- No persistence entity and no password hash ever reaches a response body.
- Every ingress schema sets `additionalProperties: false`, **including every
  nested object.** It is not inherited: without it on the nested `address`,
  `{ line1: "x", isAdmin: true }` validates. **[verified]**
- The decoded JWT payload is validated as untrusted input, and its schema must
  declare `iat` and `exp` or it fails its own `additionalProperties: false`.
  **[verified]**
- The balance update and the transaction insert always occur inside one database
  transaction.
- Money never appears as a decimal anywhere inside the service boundary. The
  only decimal→integer conversion in the codebase is `toPennies`, and it is also
  the only 2dp validator. **[F6]**
- Transactions are append-only. No update or delete path exists for them, at any
  layer. `transactions` has no `updated_at` column, which is part of the
  guarantee rather than an omission. **[F12]**
- `updatedTimestamp` is maintained by a database trigger, never by application
  code. The Kysely column type declares `never` in the update position so an
  attempt to set it is a compile error. **[F12] [verified]**
- No test helper drops or truncates anything without first asserting that the
  target database name ends in `_test`. **This is not in the probe's `reset.ts`
  and it must be.** A `drop schema public cascade` pointed at the wrong
  connection string is the single worst artefact this repository could contain.
  **[extends F9]**
- **No credential and no request-body value ever reaches a log record.** Log the
  offending _field names_ and Ajv's `schemaPath`; never the values. **Mechanised,
  not remembered:** the log-only parameter type declares `payload?: never` for
  every constructor reachable with client input, so re-adding it is a compile
  error. See section 8b. **[verified — this was a live defect, found and fixed]**
- **Every schema carries `as const`, and a type-level test asserts that no
  validated body type is `unknown`.** With the inferring signature (section 6b) a
  missing `as const` degrades to `unknown` _silently_ rather than erroring. The
  compiler will not tell you; the test must.
- No new endpoint without at least one sad-path test.
- No signing key, secret or credential committed to the repository.
- 403/404 **semantics** follow the supplied specification exactly. Spec
  _defects_ are a different matter — see section 6.

**Mechanised instead, and therefore no longer on this list:**

- `strict: true` (compiler).
- `@typescript-eslint/no-floating-promises` — requires type-aware linting, which
  requires the TypeScript pin in section 4. Without the pin this invariant has no
  owner at all and nothing announces it. **[F2]**
- **Every `Result` is handled.** Rev 3 kept this as a human checklist item
  because the lint plugin was rejected. Rev 4 makes it structural via the
  handler adapter in section 4 — a handler that ignores its error channel is a
  program that does not typecheck. **[F15]**

---

## 4. Closed decisions

| Area                              | Call                                                                                                                                                                      | One-line defence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package manager**               | **pnpm**, with `packageManager` pinned and `allowBuilds` committed                                                                                                        | **Standing preference, promoted to an official decision in rev 5** — it was issued at the outset and never reached rev 3, which is why `F1` reads as a surprise rather than a known cost. **The affirmative case, which is the one to make:** pnpm's symlinked layout means an undeclared transitive dependency _fails_ rather than silently resolving through npm's flat hoisting. That is deterministic tooling replacing developer discipline, which is the position the rest of this brief takes; npm is the option that would need defending. **The cost is now known rather than latent:** `F1`'s 20–40 minutes was the cost of _discovering_ that pnpm 11 renamed the key to an `allowBuilds` map in `pnpm-workspace.yaml`, that the `package.json` → `"pnpm"` field is no longer read at all, and that the gate fails _every_ `pnpm <script>` invocation rather than warning. The answer is written down, so it is a two-line commit in step 0a. See the two guards below. **[F1, accepted rather than avoided]** |
| **TypeScript version**            | **Pinned to the 6 line (`~6.0`)**                                                                                                                                         | A bare install resolves to **7.0.2**, and typescript-eslint 8.65 declares `<6.1.0` then hard-aborts at startup: "typescript-eslint does not support TS 7.0". Opting into the native-port compiler costs the entire type-aware lint ecosystem, including `no-floating-promises`, which section 3 delegates to it. Pin it, and put one line in an ADR — "why is this repo not on the current TypeScript" is exactly what a staff reviewer asks. **[F2] [verified]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| HTTP framework                    | Express 5                                                                                                                                                                 | Boring, legible to non-Node reviewers, native async error propagation — including from `async` middleware, which is what the JWT 401 path depends on. **[F5, closes a rev-3 unknown favourably]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Persistence                       | Postgres via compose + Kysely                                                                                                                                             | SQL-forward, thin, migrations included, explicit locking available and visible rather than abstracted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Money**                         | Integer pennies in an `INTEGER` (int4) column                                                                                                                             | int4 holds £21.4m in pennies against a spec that caps accounts at £10,000 — four orders of magnitude of headroom — and node-postgres parses it as a native `number` with no configuration. **int8 and `numeric` both return strings**, which would make the Kysely type declaration a lie that `strict: true` cannot catch: `row.as_int8 + 1` typechecks and evaluates to `'10991'`. `sum(integer)` also returns a string. int4 overflow is a hard error, not a silent wrap. **[verified twice]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **2dp validation and conversion** | **One function, `toPennies(amount): Result<Pennies, InvalidAmount>`, at the ingress→domain boundary**                                                                     | **Rev 4 addition, and a departure from the probe.** Round first, then assert the rounding moved the value by under a fraction of a penny: `const scaled = amount * 100; const p = Math.round(scaled); if (Math.abs(scaled - p) > 1e-6) → err`. Exact across all 1,000,001 legal amounts. See section 6a for the rejected alternatives and why this shape rather than an Ajv keyword. **[F6, mechanism verified]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Account-number minting**        | **Random `01` + six digits, insert-and-retry on unique violation, bounded at 5 attempts; plus `CHECK (account_number ~ '^01[0-9]{6}$')`**                                 | **Rev 4 addition.** The keyspace is exactly 10^6 — eight characters reads far larger than it is — so at 1,000 accounts the collision chance is 39%. A take-home will never collide; the point is that the _failure mode_ must be chosen, and unchosen it is an unhandled `23505` producing a 500 on a request that should have succeeded. Retry **only** on `23505` **and only when the violated constraint is the account-number one** — a foreign-key violation is not retryable, and a future unique index must not make the loop spin. Insert-and-retry, never check-then-insert. **[F11, extended]**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Timestamps**                    | **Trigger-maintained, `ColumnType<Date, never, never>`**                                                                                                                  | **Rev 4 addition.** `createdTimestamp` and `updatedTimestamp` are `required` on `UserResponse` and `BankAccountResponse`. Application-maintained means every write path must remember, forgetting is silent, and it must be remembered in write paths that do not exist yet (the deferred `PATCH`es). One `before update` trigger per table makes it unforgettable and lets the type system enforce that the app does not try. Verified: `debitIfSufficient` sets only `balance_pennies` and `updated_at` still moves. **[F12] [verified]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Withdrawal correctness            | Conditional `UPDATE` inside an explicit transaction, **plus an existence check on the zero-row path** — see section 7                                                     | Correctness of the arithmetic falls out of the conditional check; correctness of the _status_ does not, and rev 3 was wrong about that. **[F10]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Repository port                   | `debitIfSufficient(accountNumber, amountPennies): Result<NewBalance, InsufficientFunds \| NotFound>` — one method owning BEGIN/COMMIT and the transaction-row insert      | Takes no balance parameter, so the fatal "reuse the balance from the ownership resolve" optimisation is not expressible. Error channel widened by `F10`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Handler adapter**               | **`publicHandler` / `authedHandler`, ~20 lines, built in step 1**                                                                                                         | **Rev 4 addition, and a synthesis rather than a straight adoption of `F15`.** Handlers receive a request and return `Promise<Result<Success<T>, DomainError>>` — never `res`, so they have no way to send a response, and the only thing they can do with a `Result` is return it. `.match()` inside the adapter is the single place a `Result` is consumed and it is exhaustive by construction. `Success<T>` carries the status code, so `res.json(undefined)` (section 8, criterion 5) becomes a type error. `authedHandler` runs authentication _inside the adapter_ and short-circuits on failure, so the handler signature is `(userId: UserId, req) => …` and `userId` is honestly typed `string`. Cost, stated honestly: handlers cannot stream, set custom headers, or send non-JSON. Fair for this API. **[F15, modified — see section 8a]**                                                                                                                                                                    |
| Password hashing                  | `bcryptjs`, cost factor from config: **12 default, 4 in tests**                                                                                                           | Pure JS, no native compilation, so a reviewer's install cannot fail on a node-gyp toolchain that isn't there — which matters more under pnpm, where native rebuilds also interact with the `allowBuilds` gate. The cost: **~50–60ms per hash at cost 10, ~55ms per compare, fully serialised** — ten concurrent hashes take 538ms, 10.4× one hash, and the async API yields the event loop exactly **once** against 45 ticks for genuinely interleaving work. So roughly 20 logins per second per process, and a worker thread or native bcrypt is the fix at real scale. `hashSync` is four characters away, appears in most examples, and yields zero times. Making the cost configurable also removes bcrypt from the suite's critical path — it was a third of the probe's 6 seconds. **[F14, extended] [measured]**                                                                                                                                                                                                  |
| **2dp: both mechanisms, not one** | **Ajv `currencyScale: 2` at ingress _and_ `toPennies` at the domain boundary**                                                                                            | **Rev 6 reverses rev 5's "departs from F6".** They are complementary, not duplicative: the keyword produces a proper spec-shaped `details` entry at ingress, `toPennies` is the structural guarantee that conversion cannot happen without validation, and the service keeps the null branch as belt-and-braces. Two further points rev 5 missed — the ordering footgun is real but is now documented at the registration site _and_ covered by a test asserting the loud `strict mode: unknown keyword` failure; and `S extends object` (section 6b) is what lets a custom keyword coexist with type inference at all, because `satisfies JSONSchema` rejects `currencyScale`. The constraint that fixed TS2589 is the same one that makes the keyword possible. **[F6, both halves]**                                                                                                                                                                                                                                   |
| **Observability**                 | **Log-at-construction in the seven error constructors; correlation id minted once per request via `AsyncLocalStorage`; level follows `kind`; renderer logs outcome only** | Added by the second probe round. Errors cannot exist unlogged because the constructors _are_ the chokepoint, and the id is intersected onto the union in one place so a new member cannot forget it. **Subject to the redaction rule in section 8b, which is not optional.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Egress validation**             | **Every success body validated against the published response schema, inside the handler adapter, on the _serialised_ form**                                              | Added by the second probe round. The justification that matters is not "it is cheap": `additionalProperties: false` on response schemas turns section 3's "no persistence entity and no password hash reaches a response body" from a checklist item into a _checked_ property — a leaked `password_hash` becomes a 500 rather than a disclosure. See section 8c for the trap that makes it more than a copy of the ingress path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| DI                                | Manual composition root                                                                                                                                                   | One file, no library, obvious to any reader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Errors                            | `neverthrow`, closed union of domain errors, **one renderer with two sources** — see section 8                                                                            | Insufficient funds is an expected outcome, not an exception.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Validation                        | `isJsonValidRz(schema)` — Ajv + `json-schema-to-ts` at every ingress, **type inferred from the schema argument, no explicit type parameter anywhere**                     | **Changed in rev 6.** One JSON Schema as the source of truth for runtime validation _and_ the compile-time type, with **no second position in which to state the shape differently**. Rev 5's call-site naming left `isJsonValidRz<CreateTransactionBody>(createUserSchema)` typechecking cleanly; that hazard was live in two of four validators on the probe branch. Now unrepresentable. Rejecting unknown keys closes mass assignment — verified, including `__proto__` caught as an unknown key rather than polluting the prototype. See section 6b for the signature and its one new hazard. **[F7 as amended] [verified]**                                                                                                                                                                                                                                                                                                                                                                                         |
| **Schema provenance**             | **Hand-written, not lifted from the supplied YAML**                                                                                                                       | OpenAPI 3.1 schema objects are JSON Schema draft 2020-12; the default `ajv` import is draft-07, so a lifted schema carrying `$schema` throws `no schema with key or ref …/2020-12/schema` at compile time. Hand-writing also means `additionalProperties: false` is present by construction rather than by editing. **[F7]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OpenAPI                           | Hand-edit the supplied YAML — **in step 0, not at the end**                                                                                                               | The spec is an input to the build, not only a deliverable. See section 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Test runner                       | vitest                                                                                                                                                                    | Ran ESM TypeScript with supertest and Express 5 at zero config. **[verified]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Test isolation**                | **`fileParallelism: false`; leave `isolate` at its default `true`**                                                                                                       | **Rev 4 change, and a departure from the probe.** The default is confirmed parallel, so `fileParallelism: false` is required for truncate-based isolation. `F4` then recommends `isolate: false` to collapse the run to one process and share the pool. Declined: `isolate: false` leaks module state between files, which presents as a test that passes alone and fails in suite — an unmeasurable, nasty cost traded for a measurable, trivial one (a pool per file) on a suite that runs in six seconds. `singleFork` is unnecessary once `fileParallelism` is false. **[departs from F4]**                                                                                                                                                                                                                                                                                                                                                                                                                           |

**pnpm, two guards, both step 0a.**

- **`packageManager: "pnpm@11.x"` in `package.json`, committed.** Not decoration.
  `allowBuilds` is pnpm-11 spelling; pnpm 10 ignores it and reads the superseded
  `onlyBuiltDependencies` instead, so setting the right key in the right file
  still leaves the build ignored on the wrong tool version. Pinning the package
  manager is what makes the `F1` fix reliable rather than version-dependent.
- **`corepack enable` in the README's prerequisites**, with a global-install
  alternative. The reviewer's machine may have no `pnpm`, and corepack's
  long-term place in Node core is unsettled — it ships but is off by default.
  This is a reviewer-friction residual, not a build risk: entry in
  `docs/residual-risk-catalogue.md`. `pnpm install --frozen-lockfile` in the
  README requires both the lockfile and `pnpm-workspace.yaml` committed, or the
  reviewer hits `F1` exactly as the build session would have.

**Ajv configuration.** Do **not** use `strict: false` to work around the spec's
malformed `format` keywords — it makes them silently validate nothing, so
`accountNumber: "GARBAGE"` passes. Fix the spec instead (section 6). `strict: true`
_throws_ on a regex left in a `format` keyword, which is what makes section 6's
six defects findable rather than silent — keep it. **[verified]**

**`ajv-formats` needs an interop cast.** Its dist does
`module.exports = exports = formatsPlugin` while its `.d.ts` declares an ESM
`export default`. Under `nodenext` + ESM, TypeScript types the default import as
the module _namespace_ (not callable) while Node hands you the function.
`esModuleInterop: true` does **not** fix it, because `verbatimModuleSyntax`
suppresses the synthesised interop. Needs
`addFormatsCjs as unknown as (typeof addFormatsCjs)['default']`. **[F7] [verified]**

**Do not enable `exactOptionalPropertyTypes`.** It is not part of `strict: true`.
`json-schema-to-ts` emits `line2?: string | undefined`, which under that flag is
not assignable to a repository input declaring `line2?: string`. Free friction,
no benefit at this scale. **[F7]**

**Kysely import gotcha.** `Migrator` and `FileMigrationProvider` are only on the
subpath export in 0.29: `import { Migrator } from 'kysely/migration'`. Both are
`undefined` on the root export. Every tutorial and model completion has the old
path, and this lands inside the step-0 stop line. **[verified twice]**

**ESLint configuration, two items, both step 0:**

- `argsIgnorePattern: '^_'`. Without it, `no-unused-vars` reports `_next` on the
  error middleware — and the fourth parameter is the _only_ thing making the
  function an error handler. Taking the linter's advice demotes it to ordinary
  middleware, every error starts rendering as an HTML stack trace, and the lint
  run goes green. Put the reason in a comment so the tooling cannot advise
  breaking the app. **[F8] [verified]**
- Use `eslint.config.mjs`, not `.ts`. A TypeScript config file requires `jiti`
  installed or ESLint 10 aborts. **[F2]**

---

## 5. On dropping `eslint-plugin-neverthrow`

**Rev 5 rewrites this section, because rev 3 and rev 4 defended the decision on a
premise that is false.**

Evaluated and rejected. `handledMethods` in its source is a hardcoded
`['match', 'unwrapOr', '_unsafeUnwrap']` with no concept of `isOk`/`isErr`
narrowing, so it flags guard-style handlers — reproduced on ESLint 8.57 with no
shim, across four distinct guard-style handlers. **[verified]**

**The premise that was wrong.** Rev 3 concluded from that: "adopting an unfamiliar
handler style across the codebase to satisfy an unmaintained plugin, inside a
12-hour budget, buys less than it costs." But guard style is the probe's
assumption, not mine — **I terminate every `Result` with `.match()` as a matter of
daily practice.** The plugin's `handledMethods` therefore matches how I already
write, and it would not have flagged my code. The style cost is zero and that
argument evaporates.

**What actually survives, and it is enough.** The plugin was last published
2022-05, requires a hand-rolled flat-config shim to run on ESLint 9 at all, and
this project is on ESLint 10. The decision is unchanged; the reason is now
dependency health rather than style, which is a cleaner line in an ADR and a
cleaner answer under questioning. Do not defend it on style grounds.

**The adapter is not a consolation prize.** Rev 4 justified the handler adapter
(section 8a) as compensation for the rejected plugin. It stands on its own:
`.match()` in one provably-exhaustive place beats `.match()` repeated at every
handler, whether or not a linter is watching. Read as a _refinement_ of the
`.match()`-everywhere habit rather than a departure from it — the call still
happens, once, where the compiler can require it.

**Where the mechanisation gap actually remains.** With the adapter, an unhandled
`Result` at the HTTP boundary does not compile. A `Result` dropped _inside_ a
service — created, never inspected, not returned — still has no mechanical owner.
Three options, in ascending order of quality:

1. **Nothing.** The `no-floating-promises` rule catches the async subset. Section
   3's checklist covers the rest by eye.
2. **A Claude skill** that reviews for unhandled `Result`s. Cheap, portable across
   projects, and it _can_ reason about `isOk`/`isErr` narrowing, which the dead
   plugin cannot. Be honest about the limitation: it is a model reading code, so
   it is not deterministic, which makes it different in kind from a lint rule
   rather than merely weaker. Sits outside this repository.
3. **A small custom typescript-eslint rule.** Perhaps forty lines against the type
   checker, and it understands narrowing, so it is strictly better than the
   abandoned plugin. The type-aware lint infrastructure already exists — that is
   what the section 4 TypeScript pin is protecting. This is the right answer and a
   strong pair-coding extension.

**Do not build 2 or 3 inside the 12 hours.** Catalogue entry, and have the
argument ready: the invariant is mechanised where it is cheapest to mechanise (the
boundary, structurally) and left to review where mechanising it would have cost
more than the build budget — with the specific tool that would close it named and
sized.

---

## 6. Specification changes — step 0, not the final 90 minutes

**This is a sequencing point.** The ingress schemas derive from the spec, so the
spec is upstream of signup → login → the keystone ownership endpoint → all of
evening 2. A single omission blocks the entire build.

**Forced — the build cannot proceed without these:**

1. **No password field** in `CreateUserRequest` or `UpdateUserRequest`. With
   `additionalProperties: false`, a signup carrying a password is rejected at
   ingress. Add it.
2. **No auth endpoint.** Add `POST /v1/auth/login` — an explicit deliverable of
   the brief regardless.
3. **Six `format:` keywords holding regexes** (`^01\d{6}$`-style) in
   `components.schemas`. These mean `pattern:`. Independently recounted in rev 4:
   `BankAccountResponse.accountNumber`, `TransactionResponse.userId`,
   `CreateUserRequest.phoneNumber`, `UpdateUserRequest.phoneNumber`,
   `UserResponse.id`, `UserResponse.phoneNumber`. Path parameters already use
   `pattern:` correctly, so the defect is confined to schemas. `email`,
   `date-time`, `double`, `int32`, `int64` are known to ajv-formats and need no
   change.

**Corrective — defects, not design choices:**

4. `^tan-[A-Za-z0-9]$` is single-character and rejects the spec's own `tan-123abc`
   example. It appears **twice**: as the `transactionId` path-parameter schema,
   where it 400s every real request, and on `TransactionResponse.id`, where it
   makes response conformance _unachievable_ — no id both satisfies it and is
   unique beyond 62 transactions. Widen to `^tan-[A-Za-z0-9]+$`. **[F13]**
5. ~~`accountId` versus `accountNumber` mismatch across four path keys.~~
   **Corrected in rev 4: this claim was wrong.** `accountId` appears **zero**
   times in the supplied `openapi.yaml`; every path template and parameter uses
   `accountNumber`. The real mismatch is between the _scenario document_, which
   says `accountId` throughout, and the spec, which does not. Still worth writing
   up — and it is a better observation — but do not state it as a spec-internal
   inconsistency, because a reviewer will ask to be shown it.
6. `POST /v1/users` 400 is the only 400 in the document with no body schema.
   Confirmed. Give it `BadRequestErrorResponse` like every other 400.

**New, created by change 1:** email becomes the login identifier, so duplicate
signup is a real path with no defined status. Add a unique constraint and a
**409**. This is a genuine new build item.

**Promoted in rev 4 from "note" to written-up changes.** These are cases where
the specification _cannot be satisfied_, which is a different category from
"odd", and noticing that a spec is internally unsatisfiable is a much better
signal than noticing it has copy-pasted descriptions. **[F13]**

- **The balance ceiling.** `BankAccountResponse.balance` declares
  `maximum: 10000.00`; `CreateTransactionRequest.amount` declares
  `maximum: 10000`. So two legal £10,000 deposits produce a balance the response
  schema cannot represent — verified by validating real responses against the
  supplied schemas. Every available behaviour breaks something: honour the
  ceiling and you must invent a status the spec does not define; ignore it and
  you serve a body failing your own published schema. **Chosen: allow the
  balance to exceed the ceiling, and remove `maximum` from
  `BankAccountResponse.balance`,** with one line of reasoning. Record in
  `docs/spec-changes.md`.
- **The `tan-` pattern**, as item 4 above.

**Still "note, don't build":**

- `minimum: 0.00` permits a £0 transaction. **Rev 4 departs from the probe here:
  implement the spec as written and allow it.** The probe returns 400 via
  `exclusiveMinimum: 0`, which is defensible but is a status the spec does not
  sanction, and the assessed criterion is conformance. Allowing it costs nothing
  and the objection goes in `docs/residual-risk-catalogue.md`, which turns a possible ding
  into a discussion point. **[departs from F13]**
- The seven copy-pasted 403 descriptions.
- `POST /v1/users` correctly has no 401/403, while the scenario document says
  "Given a user has successfully authenticated" for creating one. Harmless.

**Distinction worth keeping straight.** The 403/404 _semantics_ are an
intentional design choice and I defer to them (section 3). A `format` keyword
containing a regex is a defect. Different category, same handling: correct it,
and record it.

**P7 — favourable constraint.** `TransactionResponse` has no `accountId`, so the
"transaction belongs to a different account you own → 404" scenario cannot be
enforced by fetch-then-compare and must be scoped in the query
(`WHERE id = ? AND account_id = ?`). That is the correct implementation anyway.
Verified end-to-end: the query-scoped fetch returns 404 for a transaction
requested under the wrong account number, and a fetch-then-compare implementation
would have had nothing to compare. Note it as a case where the spec's shape
constrained the design well. **[verified]**

---

## 6a. Money at the boundary — the mechanism, and the trap

`amount` arrives as a JSON number with "up to two decimal places" in prose.
Something must reject `10.999` and turn `10.99` into `1099`. Rev 3 ruled out the
one mechanism it named and never named another. **[F6]**

**Rejected, with evidence.** Across all 1,000,001 legal 2dp amounts in the spec's
`0.00`–`10000.00` range:

| Check                            | Legal amounts wrongly rejected |
| -------------------------------- | ------------------------------ |
| `multipleOf: 0.01`               | **157,274** (15.7%)            |
| `Number.isInteger(amount * 100)` | **131,256** (13.1%)            |
| round-then-check-slack           | 0                              |

`Number.isInteger(x * 100)` is the one the session will suggest, and it is
_nastily_ broken because the obvious spot-checks pass: `10.99 * 100 === 1099`,
but `0.29 * 100 === 28.999999999999996`, along with 131,255 others. **Record it
in the ADR as an explicitly rejected option**, because otherwise it gets
reintroduced.

**The mechanism.**

```ts
// the only decimal→integer conversion in the codebase,
// and therefore also the only 2dp validator
export const toPennies = (amount: number): Result<Pennies, InvalidAmount> => {
  if (!Number.isFinite(amount)) return err(...)   // 1e999 parses to Infinity
  const scaled = amount * 100
  const pennies = Math.round(scaled)
  if (Math.abs(scaled - pennies) > 1e-6) return err(...)  // more than 2dp
  return ok((pennies === 0 ? 0 : pennies) as Pennies)     // normalise -0
}
```

Two details worth keeping: `Math.round(-0 * 100)` is `-0` and `Object.is(-0, 0)`
is false, so a signed zero survives into `toBe` assertions; and `1e2` is a legal
JSON number and a legal amount while `1e999` parses to `Infinity` and must be
caught by a finiteness check, not by `maximum`.

**Both mechanisms, not one — rev 6 reverses rev 4 and rev 5 here.** Rev 4 declined
the Ajv `currencyScale` keyword on the grounds that it validates without
converting, so the property ends up asserted twice, and that its registration
ordering is a footgun. The second probe round built both and the objection does not
survive contact:

- They do **different jobs**. The keyword produces a spec-shaped `details` entry at
  ingress, which is what the 400 response requires. `toPennies` is the structural
  guarantee that no conversion can happen without validation. The service keeps
  `toPennies`' null branch as belt-and-braces behind the keyword.
- The **ordering footgun is real but now handled**: registration sits beside the
  Ajv instance with a comment recording the exact failure
  (`strict mode: unknown keyword: "currencyScale"` thrown at startup), and a test
  asserts that loud failure. `strict: true` refusing to compile an unknown keyword
  is the _good_ failure mode — the alternative is silently accepting 3dp amounts.
- The synergy rev 5 missed: **`S extends object` (section 6b) is what lets a custom
  keyword coexist with type inference at all**, because `satisfies JSONSchema`
  rejects `currencyScale`. The constraint that fixed TS2589 is the same one that
  makes the keyword possible. Use
  `as const satisfies Record<string, unknown>` on schemas carrying it.

**[F6, both halves, and a reversal of two earlier revisions]**

**Where `pattern` does not help.** `pattern` is silently ignored on a number: a
schema of `{ type: 'number', pattern: '^\\d+\\.\\d{2}$' }` accepts `10.999`. The
string-pattern machinery is not an option here. **[verified]**

---

## 6b. The validation seam — the shape that infers

**Rewritten in rev 6. `F7`'s diagnosis was right and its conclusion was wrong.**

The naive signature does not compile, and only `tsc` objects, so runtime tests
stay green while the foundation is broken:

```ts
// TS2589 "Type instantiation is excessively deep and possibly infinite"
// TS2590 "Expression produces a union type that is too complex to represent"
function validator<const S extends JSONSchema>(
  schema: S,
): (body: unknown) => Result<FromSchema<S>, DomainError>;
```

The cause is a multiplication, not any one library: an unresolved `FromSchema<S>`
distributed across the whole `JSONSchema` union, multiplied by the seven-member
`DomainError` union, inside `Result`. Isolated reproductions of each half compile
fine — which is why probing the libraries separately could not have found it.

**`F7` concluded that no inferring shape exists. That was too strong.** Constrain
the parameter to `object`, so there is no union to distribute over, and apply the
intersection at the instantiation site:

```ts
export function isJsonValidRz<S extends object>(
  schema: S,
): (body: unknown) => Result<FromSchema<S & JSONSchema>, DomainError> {
  type T = FromSchema<S & JSONSchema>
  ...
}
```

**[verified at the branch's exact lockfile — TypeScript 6.0.3, json-schema-to-ts
3.1.1, ajv 8.20.0]:** project-wide `tsc --noEmit` clean with no TS2589 or TS2590
and **every explicit type parameter deleted from all five call sites**; the
validation probe passes 21/21; typecheck wall time unchanged at 1.73s against a
1.73s baseline. The inference is genuine rather than silently degraded — handlers
destructure validated bodies and compile.

**Why this beats rev 5's recommendation.** Rev 5 said: name the type at the call
site, `isJsonValidRz<CreateUserBody>(createUserSchema)`. That keeps the shape
written once but leaves the asserted type and the validated schema _independent_,
so `isJsonValidRz<CreateTransactionBody>(createUserSchema)` typechecks cleanly.
The hazard was live in two of the four validators on the probe branch, where
inline hand-written types restated inline schemas with nothing keeping the two
statements in agreement. With inference there is no second position to get wrong,
so a mismatched assertion is **unrepresentable** rather than something review or a
linter has to catch. That is the difference between a convention and a guarantee,
and it is the whole reason the helper exists.

**The one new hazard, and it is a nasty one.** Inference requires `as const` on
every schema. Without it the literal types widen, `FromSchema` has nothing to work
from, and the validated body **degrades to `unknown` silently** — no error, just a
body you cannot read. The first attempt at this patch hit exactly that on the two
un-`as const`ed inline route schemas, which is why they are hoisted to named
constants with `as const satisfies Record<string, unknown>`. So:

- `as const` in the schema module is **load-bearing, not advisory**. Say so in a
  comment at the top of the file.
- **A type-level test asserting no validated body type is `unknown` is mandatory,
  not optional.** It is cheap and it is the only thing standing where the compiler
  will not. Section 3 invariant.
- Use `as const satisfies Record<string, unknown>`, **not** `satisfies JSONSchema`
  — the latter rejects the custom `currencyScale` keyword (section 4).

**The pin is now load-bearing twice.** This result depends on compiler internals
at one pinned TypeScript version. Rev 5 pinned `typescript@~6` to keep type-aware
lint; rev 6 notes it is also what keeps this inference working. Both reasons go in
the ADR, because "why is this repo not on the current TypeScript" now has a
two-part answer and the second part is more interesting than the first.

**The documented fallback, if a future TypeScript reintroduces the blowup:**
retreat to `isJsonValidRz<FromSchema<typeof createUserSchema>>(createUserSchema)`,
which also compiles. It does not make a mismatch a type error, but it keeps the
type textually adjacent to the schema it was derived from. Catalogue entry, so the
retreat is a decision rather than an improvisation.

**Why this shape differs from the reference implementation, in one paragraph, because
the build session will notice.** The reference `isJsonValidRz` takes a _precompiled_
`ValidateFunction` and is called directly, `isJsonValidRz<FromSchema<typeof
fooJsonschema>>(payload, validateFoo)`, because a build step emits standalone
validators ahead of time. That split — schema at compile time, validator at runtime —
severs the type relationship between the asserted type and the validator, which is why
the reference design needs lint rules to force both to name the same schema. This
build compiles at module load and passes the schema itself, so the relationship is
inferable and the rules have nothing to reconstruct. The trade is real and it is
recorded in `docs/residual-risk-catalogue.md` R26: ahead-of-time compilation avoids
startup compilation and avoids runtime code generation, which matters under a strict
CSP or on a runtime forbidding `unsafe-eval`. A long-running server needs neither. One
consequence to expect: the helper is a **factory** here (`isJsonValidRz(schema)`
returning the validating function) rather than a predicate, so it reads a little
oddly against its own name. Keep the name and comment the reason — it is inherited
from a design where compilation has already happened.

**Step 0b is no longer a spike.** The question it existed to answer is answered.
It becomes a ~15-minute **port**: lift the signature, delete every explicit type
parameter, add the `unknown` type-test, confirm project-wide `tsc` is clean. If it
does _not_ reproduce cleanly against the real helper, that is new information and
section 2a's probe rules apply.

**Also settled by the same round:** `ajv-formats` still needs the interop cast
(section 4), and the ingress side is closed — `additionalProperties: false` at
every level including nested `address`, `__proto__` caught as an unknown key,
`coerceTypes: false` so `"1000"` is not accepted for a number. The one hole Ajv
structurally cannot see is symbol-keyed properties, because it walks
`Object.keys`. That is unreachable for request bodies, which are `JSON.parse`
output — worth one line so nobody spends time on it, and worth remembering only
when the funnel is pointed at an internally constructed object, which is exactly
what section 8c does.

---

## 7. The withdrawal — mechanism, boundary, and the corrected justification

```sql
UPDATE accounts
   SET balance_pennies = balance_pennies - $1
 WHERE account_number = $2 AND balance_pennies >= $1
RETURNING balance_pennies;
```

...inside an explicit transaction, followed by the transaction-row insert, then
commit.

**Why the arithmetic is correct.** Under Postgres's default READ COMMITTED, a
second transaction updating the same row blocks on the first's row lock. When the
first commits, the second does _not_ proceed against its stale snapshot — it
re-reads the updated row and re-evaluates its `WHERE` clause against the new
values. So `balance >= $1` is checked against the balance _after_ the first
withdrawal, and the second correctly fails. No lost update, no explicit lock.
This works because the new value is computed from the row's current value inside
the database, never from a value the application read earlier.

**[verified twice, independently, against Postgres 17 with real concurrent
connections]:** two £100 withdrawals from £100 → one 201, one 422, balance 0, one
transaction row. Twenty concurrent £10 withdrawals from £100 → exactly ten
succeed, balance 0. The naive read-modify-write loses the update, taking £200
from a £100 account with both callers reporting success. REPEATABLE READ →
`40001 could not serialize access`.

### The correction — rev 3's justification for the 422 was false

Rev 3 said: "because it runs first, a zero-row update can only mean insufficient
funds → 422." **That is wrong, and it misreports 404 as 422.** The ownership
resolve and the conditional `UPDATE` are separate statements on separate
connections. Anything removing the row in between produces a zero-row update for
a reason that is not insufficient funds — verified: the client is told
`422 "Insufficient funds"` for an account that does not exist, which moments
earlier held £100 against a £10 withdrawal. **[F10]**

This is not hypothetical for this build: the racing endpoint is
`DELETE /v1/accounts/{accountNumber}`, which the spec defines and section 9
defers. So rev 3 shipped the vulnerable half and deferred the half that triggers
it — the most likely way for it to go unnoticed.

**The fix, which does not touch the happy path.** On zero rows, ask whether the
row exists at all. The second query only ever runs on the failure path:

```
zero rows -> SELECT 1 FROM accounts WHERE account_number = $1
             found     -> InsufficientFunds (422)
             not found  -> NotFound (404)
```

**The honest headline, replacing rev 3's:** the conditional update makes the
_balance arithmetic_ correct without a lock. The _status taxonomy_ is not atomic,
because the resolve and the debit run on different connections. A follow-up
existence check on the failure path narrows the misreport to a window measured in
microseconds; it does not eliminate it.

**The version that does eliminate it — keep this in your pocket, do not build
it.** Move the ownership resolve inside the same transaction and take a row lock:

```sql
BEGIN;
SELECT user_id FROM accounts WHERE account_number = $1 FOR UPDATE;
  -- 0 rows        -> 404
  -- user_id ≠ me  -> 403
UPDATE accounts SET balance_pennies = balance_pennies - $2
 WHERE account_number = $1 AND balance_pennies >= $2 RETURNING balance_pennies;
  -- 0 rows -> 422, and now this is genuinely the only possibility,
  --           because we hold the lock and the row cannot vanish
INSERT INTO transactions ...;
COMMIT;
```

This makes rev 3's original claim true — but only because the lock is what makes
it true. It costs one extra round trip inside the transaction, serialises
concurrent access to a single account, and makes the port's "takes no balance"
defence unnecessary (reusing a locked read is safe). **Being the one to raise
this in the walkthrough is a much stronger position than being shown it.** Entry
in `docs/residual-risk-catalogue.md`, and it is a strong pair-coding extension.

**Where the technique stops working, regardless:**

- If a value must be read, have business logic applied in application code, then
  be written back, `SELECT ... FOR UPDATE` is required — read and write are
  separate and the row can change between them.
- Same answer if the decision spans multiple rows.
- Under REPEATABLE READ or SERIALIZABLE, Postgres raises a serialisation failure
  rather than re-evaluating, so retry logic becomes necessary — and this whole
  class of interleaving becomes a `40001` rather than a misreported status.

**Why the ownership resolve stays a separate query.** Folding `user_id` into the
conditional `UPDATE` would collapse 403, 404 and 422 into one indistinguishable
zero-row result. The separate resolve exists to keep 403 distinguishable; the
zero-row case is then disambiguated between 404 and 422 by the existence check.

**Why the port method takes no balance.** The update recomputes from the row, so
reusing an earlier read is not _currently_ wrong — but it _looks_ like a
read-then-write, which invites the optimisation that kills it.
`debitIfSufficient(accountNumber, amountPennies)` makes reusing the earlier
balance inexpressible. Structural prevention, not a comment.

**Note for ADR 1:** `sum(integer)` returns bigint in Postgres, so any future
derived-balance or reconciliation query comes back as a string even with int4
columns. **[verified]**

---

## 8. Error handling — one renderer, two sources

- **Domain failures** reach the renderer as `Result` values from the service
  layer.
- **Infrastructure failures** — malformed JSON, unhandled throws — arrive through
  Express's error middleware and never touch a `Result`.

The error middleware is a **translation boundary**: it converts infrastructure
failures into the same domain error type, which then renders through the one
function that handles everything. The union stays closed because nothing else
renders an envelope.

The framing: things I control are values; things originating outside my process
are exceptions; both render in one place.

**Express 5 acceptance criteria for step 1. All [verified], twice.** Rev 3 listed
five; `F5` reproduced all five exactly and adds a sixth plus two notes.

1. **404 fallback takes no path argument.** `app.use('*')` and `app.all('*')`
   both throw at startup under path-to-regexp v8. Use
   `app.use((_req, res) => ...)` then the error handler last. (The working v8
   spelling for a named catch-all is `'/*splat'`, if one is ever wanted — worth
   knowing only because the v8 error message pushes you toward it. The path-less
   `app.use` remains the better choice.)
2. **Malformed JSON needs a dedicated branch.** body-parser's `SyntaxError`
   (`err.type === 'entity.parse.failed'`) reaches the error middleware before any
   validation runs; its default rendering is a bare 400 `{}` that does not
   satisfy `BadRequestErrorResponse`, which requires both `message` and
   `details`.
3. **With no error handler registered**, Express 5 renders that error as an HTML
   page containing a full stack trace with absolute filesystem paths.
   `NODE_ENV=production` suppresses it; dev and test runs leak it.
4. **`content-type: text/plain` or absent → `req.body` is `undefined`, not
   `{}`.** Ingress validation must handle `undefined` explicitly or a 500 lands
   where a 400 belongs.
5. **`res.json(undefined)` returns 200 with `content-length: 0`** — a silent
   empty success, and exactly the shape a handler falls into when a `Result`'s
   value is accidentally dropped. Closed structurally by the adapter (8a).
6. **`res.headersSent` needs a branch ahead of the renderer.** _New in rev 4._ A
   handler that writes a response and then throws reaches the error middleware
   with the response already committed. The renderer's first act is
   `res.status(...)`, which throws `Cannot set headers after they are sent` from
   inside the error handler — the one place with nothing above it to catch. One
   `if (res.headersSent) { res.end(); return }` is enough. **[F5]**

**The four-parameter rule, and why `strict: true` does not save you.** Express
decides a function is an error handler purely by `fn.length === 4`. Write three
parameters and it becomes ordinary middleware: the error skips it, Express's
default handler runs, and criterion 3's stack-trace leak is silently reinstated.
TypeScript does _not_ report "wrong arity for an error handler" — it silently
reinterprets `(err, req, res)` as `(req, res, next)`, and the only diagnostic is
`Property 'status' does not exist on type 'NextFunction'`, which points at the
body and never at the arity. You are protected, but by a misleading error.
**Annotate the handler `ErrorRequestHandler`** so the protection is legible. And
see the `argsIgnorePattern` item in section 4 — the linter will otherwise advise
deleting the parameter that makes it work. **[F5, F8]**

---

## 8a. The handler adapter — step 1, ~20 lines

```ts
type Success<T> = { status: 200 | 201; body: T };

function publicHandler<T>(
  fn: (req: Request) => Promise<Result<Success<T>, DomainError>>,
): RequestHandler;

function authedHandler<T>(
  fn: (
    userId: UserId,
    req: Request,
  ) => Promise<Result<Success<T>, DomainError>>,
): RequestHandler;
```

**What it buys.** Handlers never receive `res`, so they have no way to send a
response — the only thing they can do with a `Result` is return it. `.match()`
inside the adapter is the single place in the codebase where a `Result` is
consumed, and it is exhaustive by construction. A handler that ignores its error
channel is not a bug to spot in review; it is a program that does not typecheck.
`Success<T>` carrying the status makes a dropped value a type error, closing
criterion 5 for free. **[F15] [verified across 20 end-to-end tests]**

**Where rev 4 modifies the finding.** `F15` also proposes replacing
authentication middleware with a plain function returning
`Result<UserId, DomainError>`, on the grounds that middleware mutating `req`
leaves every downstream handler trusting that it ran, with `req.userId` either
`string | undefined` (redundant checks everywhere) or lied about as `string`.
That critique is correct. The proposed remedy is worse than necessary: a plain
function reintroduces "forgot to authenticate" as a possible bug, which is the
one thing middleware genuinely guarantees, and it reads as unfamiliar to a
reviewer expecting a Spring filter.

**Better: put authentication inside the adapter.** `authedHandler` runs the auth
function and short-circuits on failure, so a handler wanting the caller's
identity receives it as a parameter, honestly typed `string`, with no ambient
state and nothing to forget to register. The guarantee is structural _and_ the
type is honest. Same twenty lines.

**The cost, stated honestly:** handlers cannot stream, set custom headers, or
send anything but JSON. Fair for this API; not for one with file downloads.
Record it.

---

## 8b. Observability — and the one thing that must not ship

Built by the second probe round: log-at-construction inside the seven error
constructors, a correlation id minted once per request and read from
`AsyncLocalStorage`, log level following `kind`, and the renderer logging the
_outcome_ only. Adopt all of it. The design reasoning is sound and the seam is
right — the constructors already were the single chokepoint through which every
error is born, so no call site has to remember to log and no error can exist
unlogged. Four details worth keeping:

- **The id is minted once per request, not once per error.** If each error minted
  its own, two records from one request share nothing and the collector has
  nothing to stitch — the failure that makes the mechanism pointless while still
  looking like it works.
- **The id is intersected onto the union in one place**, not repeated per member,
  so adding a member cannot forget it. The renderer's `never` default branch still
  proves totality; verify that survives the intersection.
- **Level follows `kind`.** The 4xx members are ordinary client mistakes and belong
  at `info`/`warn`; `Unexpected` is the only genuine error. Without this,
  log-at-construction is an alert on users behaving normally.
- **Constructors log detail, the renderer logs outcome, and never both.** Otherwise
  every failure produces two records carrying the same information and the
  correlation id works against legibility.

### The credential-logging defect, and the fix that is better than a rule

**The defect.** The second round logged the full offending request body, and its
own test asserted it: `{ password: 'hunter2' }` in a log record. The signup schema
requires `password` at `minLength: 12`, so those were real credentials written to
the sink as JSON on any failed signup or failed login validation.

The stated defence was _"what protects it is the response boundary, not
redaction."_ That is the wrong defence. The response boundary protects the
**client**; it says nothing about who reads the log store, which is where
credentials go on to have a long and badly-governed life. Every large
plaintext-credential incident of the last decade was this shape, not a database
breach.

**The fix, as landed in `9ccd999`, and why it is better than what was asked for.**
The obvious fix is a deletion. A deletion is only as durable as the next person's
memory, and the log-only type's index signature would have accepted a re-added
`payload` in silence. So instead:

```ts
export type PayloadForbidden = LogOnly & { readonly payload?: never };
```

applied to six of the seven error constructors. Putting the payload back is a
compile error. **And the asymmetry is enforced by which constructor a call site
reaches for**, which is the part worth being able to explain:

- ingress failures go through `validationFailed` → payload forbidden;
- egress failures go through `unexpected` → payload permitted, because that body is
  the service's own output and when a response fails its published schema the
  payload is the entire diagnostic.

Same funnel, opposite call, opposite rule. `payloadKeys: shapeOf(body)` replaces
it, returning `Object.keys` only — no recursion, no values — so the question the
payload was there to answer still gets answered.

**Not a denylist of key names.** Denylists fail open and the next
credential-bearing field will not be called `password`. If a general mechanism is
ever wanted it is an allowlist of loggable fields, which is a larger piece of work
and belongs in the catalogue rather than the budget.

**Where the guarantee stops, and this is the honest caveat.** `unexpected` must
permit a payload for egress, but it is also the generic translation target for any
thrown error — so a future call site could hand it a client body and route around
the ban. Tightening it means a dedicated egress constructor or a branded payload
type. Recorded rather than built.

**One more, small and precise.** `shapeOf` is reachable from the JWT payload path,
so attacker-controlled strings can become _keys_ in a log record. Harmless with a
JSON sink, because `JSON.stringify` escapes them; it would be a log-injection
vector if the sink were ever line-oriented plaintext. Worth a line so nobody
either panics about it or forgets it when the sink changes.

### Two deliberate limits to record

- **Inbound `x-correlation-id` is ignored and the id is always minted locally.**
  Correct here: there is no upstream, and a client-controlled value would let a
  caller collide with or poison another request's correlation. Accepting
  propagation behind an allowlist of trusted callers is the extension.
- **It logs when an error is _created_, not when one _occurs_.** Code that builds
  an error and discards it produces a record for a non-event. Nothing does that
  today — every constructor call site returns immediately — but it is a real
  constraint on future code and it is the price of the guarantee.

**`correlationId` in the response envelope is spec-conformant.** Checked: neither
`ErrorResponse` nor `BadRequestErrorResponse` sets `additionalProperties: false`,
so the extra field is permitted by JSON Schema's open-by-default rule. It is still
an addition to what the specification publishes, so it belongs in
`docs/spec-changes.md` as an addition rather than a correction — and it is the
reason the id leaves the process at all, so it is worth the line.

---

## 8c. Egress validation — the trap that makes it more than a copy

Every success body is validated against its published response schema inside the
handler adapter. Adopt it.

**The justification that matters is not that it is cheap.**
`additionalProperties: false` on the response schemas turns section 3's "no
persistence entity and no password hash ever reaches a response body" from a
checklist item into a **checked property**: a leaked `password_hash` becomes a 500
rather than a disclosure. That is a section-3 invariant moving from human review to
mechanism, which is the doctrine, and it is a stronger argument than the one the
proposal leads with.

**The trap.** Ajv's type checks are `typeof`-based, so a `Date` instance satisfies
`type: 'object'` but fails `type: 'string', format: 'date-time'`, and a database
row can carry `undefined` values and class instances that `JSON.stringify` silently
drops or transforms. Validating the in-memory object therefore checks something the
client will never receive. **Validate the serialised form** — either
`JSON.parse(JSON.stringify(body))` or, better, validate after mapping to a plain
response object with timestamps already formatted. Note that the serialise-first
approach also closes the symbol-key hole from section 6b for free, since
`JSON.stringify` drops symbol keys.

This will fire immediately and correctly: `createdTimestamp` and
`updatedTimestamp` are `date-time` strings in the spec while Kysely hands back
`Date` instances. That first failure is the mechanism working.

**A failure is not a client error.** A response that does not satisfy its published
schema is a bug in the service, so it yields `Unexpected` → 500 with the mismatch
logged, never anything in the 4xx range.

**Response schemas need the two `F13` corrections applied**, or egress validation
returns 500 on entirely legal behaviour: `balance` loses `maximum`, and
`TransactionResponse.id` widens to `^tan-[A-Za-z0-9]+$`. This is the sharpest
demonstration available that the supplied spec is unsatisfiable — validating
against it verbatim breaks the service — and it belongs in the walkthrough.

**The cost to record:** every response is serialised twice. Immaterial here; at
real traffic it would be gated to non-production, and that gate is worth deciding
once rather than discovering. Catalogue entry.

---

## 9. Scope

**In:**

- `POST /v1/users`, `GET /v1/users/{userId}`
- `POST /v1/auth/login`
- `POST /v1/accounts`, `GET /v1/accounts`, `GET /v1/accounts/{accountNumber}`
- `POST /v1/accounts/{accountNumber}/transactions`, `GET .../transactions`,
  `GET .../transactions/{transactionId}`

**Deferred, documented:** all `PATCH` and `DELETE` endpoints, including the 409
on deleting a user who still holds accounts. Note explicitly that deferring
`DELETE /v1/accounts/{accountNumber}` is what hides the `F10` race — say so
rather than leaving it to be found.

**Droppable under time pressure, in this order:**

1. **JWT sophistication** (evening 1) — ship issue/verify with expiry and
   explicit algorithm; defer clock-skew tolerance, refresh, and anything beyond
   rejecting `alg: none`.
2. The two list endpoints — they add no new concepts once fetch exists.
3. The concurrency test.

**Never** the transaction slice, and never the documentation. If evening 3 is
compromised, the documentation wins over the concurrency test — it is the part
that carries the doctrine.

---

## 10. Roadmap — three evenings, ~4 hours each

Each step ends with a green suite (**tests _and_ typecheck**), a **falsification
pass against the probe branch** (section 2a, with the findings-to-slice matrix),
and a commit.

**Evening 1 — spine**

**Step 0, in this order.** The stop line is 90 minutes and rev 3 pointed it at
the wrong risk.

0a. **Toolchain, ~20 minutes.** `pnpm init`; `packageManager: "pnpm@11.x"`;
`pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }` **written before
the first script runs**, with a comment recording that the `package.json`
`"pnpm"` field is dead on pnpm 11 and that `onlyBuiltDependencies` is the
superseded key; `pnpm add -D typescript@~6` (**pinned — a bare install gets
TS 7 and kills type-aware lint**); `eslint.config.mjs` with
`argsIgnorePattern: '^_'`; `strict: true` without
`exactOptionalPropertyTypes`; vitest with `fileParallelism: false`; scripts
for `test`, `typecheck`, `lint`. Confirm `pnpm lint` and `pnpm typecheck`
both exit zero on an empty project _before_ writing code — if the `F1` gate
is live, _every_ script fails identically and the presenting symptom is "my
toolchain is completely broken".
0b. **Port the validation funnel, ~15 minutes.** No longer a spike — the second
probe round answered the question. Lift the `S extends object` signature
(section 6b), delete every explicit type parameter, add the type-level test
asserting no validated body is `unknown`, confirm project-wide `tsc --noEmit`
is clean. If it does not reproduce against the real helper, that is new
information and section 2a applies.
0c. **Spec edits** (section 6: forced 1–3, corrective 4 and 6, the two `F13`
promotions). Skip old item 5 — it was wrong.
0d. **Database.** compose with an **explicitly named volume** (`F9`: the
`postgres` image declares `VOLUME`, so Docker creates an anonymous one even
when compose asks for none, and carries it across container recreation —
presenting as `relation "users" already exists` from a migration that is
fine). `docker compose down -v` in the README troubleshooting line. Test
helper does `drop schema public cascade; create schema public` before
migrating, **guarded by an assertion that the database name ends in `_test`.**
0e. Skeleton: health endpoint, one passing test, standalone path documented.

**Hard stop at 90 minutes.** If the database is not reachable, take the fallback
in section 11 and move on. Note that 0a and 0b are now the realistic ways to hit
the stop line, and section 11's fallback rescues neither — which is why they run
first, while there is still budget.

1. Error envelope, one renderer, two sources, 404 fallback — against the **six**
   acceptance criteria in section 8. **Plus the handler adapter (8a), `toPennies`
   and `currencyScale` (6a), and observability (8b — including the redaction rule)
   in the same step**, before any endpoint exists. Observability belongs here
   rather than later because log-at-construction changes the error constructors,
   and retrofitting it after six endpoints exist means touching all of them.
   **Egress validation (8c) goes in as soon as the first response schema exists**,
   i.e. with step 2, not at the end.
2. `POST /v1/users` — bcryptjs with configurable cost, persistence, repository
   port, unique email constraint with 409, timestamp triggers.
3. `POST /v1/auth/login`, JWT issue and verify. Test the 401s.
4. `GET /v1/users/{userId}` with the ownership check. **The keystone** — it
   establishes the 403/404 pattern every later endpoint copies. Get it right
   once.

**Evening 2 — domain**

5. Accounts: create (with minting and the `CHECK` constraint), list, fetch.
   Pattern-match step 4.
6. Transactions: create via `debitIfSufficient` including the `F10` existence
   check, 422 on insufficient funds, list, fetch with the query scoped to
   `account_id` (section 6, P7).

**Evening 3 — proof and paperwork**

7. Sad-path coverage across everything built. Concurrency test as a **stretch
   goal only**.
8. **Final 90 minutes, reserved regardless of code state:** README, ADRs,
   `docs/residual-risk-catalogue.md`, `docs/spec-changes.md`. Then a **cold-start
   rehearsal** — fresh clone into a fresh directory, `corepack enable`,
   `pnpm install --frozen-lockfile`, `docker compose up -d --wait`, `pnpm test`
   — because that is the reviewer's first experience and it is the one path
   nothing else exercises. It is also the only thing that catches an
   uncommitted `pnpm-workspace.yaml` walling the reviewer with `F1`. Budget ten
   minutes.

**Devcontainer note, corrected.** Rev 3 described the compose risk backwards. The
devcontainer uses **docker-in-docker**, so the inner daemon runs inside the
container and shares its network namespace: published ports land on the
devcontainer's own loopback, `localhost:55432` connects, and **the connection
string is identical to the reviewer's standalone path** — no divergence to
document. The compose service name is _not_ resolvable (`db: Name or service not
known`), i.e. the string rev 3 predicted would be needed is the one that fails.
Named-volume workspace is a non-issue. `docker compose up -d --wait` reached
healthy in 2.9s. **[F3] [verified]**

Two smaller residual risks replace it: the inner daemon's image store is its own
volume, so the first `compose up` after a devcontainer rebuild pays a full
`postgres:17-alpine` pull (424MB) — _that_ is what could eat the stop line; and
DinD is what makes any of this work, so dropping it from `devcontainer.json`
silently reintroduces every problem rev 3 feared. Pin the feature with a comment
saying why.

---

## 11. Fallback, decided in advance

If the database layer is not working at the 90-minute stop line: drop to a
single-process in-memory implementation behind the same repository port, and say
so in the README along with what it costs.

**But write the SQL and the migration anyway, unwired**, and reference them from
ADR 2. Ten minutes, and it prevents the fallback from silently deleting the
single best artefact in the submission.

**Rev 4 addition:** under the fallback the timestamp triggers do not exist, so
timestamps become application-maintained and the `never` column types no longer
enforce anything. Say that explicitly rather than letting a reader assume the
trigger design is live.

---

## 12. Deliverable documentation

Four artefacts, each answering a distinct question. **Resist a fifth** — three
overlapping documents get read as none. (`docs/divergences.md` from section 2a is
a build-time working document, not a deliverable. Promote it only if it turns out
to be interesting; otherwise fold its content into commit-message bodies and let
the ADRs carry the conclusions.)

**`README.md`** — how to run it, what is in scope, the dependency table (one line
per direct dependency, which doubles as the answer to "defend your dependencies"),
`docker compose down -v` troubleshooting, and links to the three below. Plus two
sentences on the TypeScript choice, and one line on why the devcontainer exists
with the standalone path so Docker is never mandatory.

**`docs/adr/`** — one short markdown file per significant decision, under a page
each: context, choice, alternatives, consequences.

1. **Money as integer minor units in int4** — why not int8 or `numeric` (both
   return strings; the lying type declaration is demonstrable), the
   `ColumnType<string, number, number>` option at real scale, the `sum(integer)`
   note, **and `toPennies` with `Number.isInteger(x*100)` recorded as explicitly
   rejected.**
2. **Withdrawal concurrency** — the conditional update, why the arithmetic is
   correct under READ COMMITTED, **the corrected status story and the existence
   check**, the `SELECT ... FOR UPDATE` variant that closes the window and what
   it costs, where the technique stops working, and the port shape that prevents
   its misuse.
3. **Errors as values** — one renderer, two sources; the handler adapter making
   "every `Result` is handled" a compile-time property at the boundary; why the
   lint plugin was rejected **on dependency health rather than on style** (section
   5); and the custom lint rule that would close the remaining in-service gap,
   named and sized.
4. **Scope deferrals** and the reasoning behind them. **Plus the TypeScript
   pin**, which now has a two-part answer: type-aware lint (section 4) _and_ the
   validation inference (section 6b) both depend on it. "Why is this repo not on
   the current TypeScript" is a staff-level question and the second half of the
   answer is the more interesting one.
5. **Validation as a single funnel** — one schema driving runtime validation and
   the compile-time type with no second position to state the shape; why the
   inferring signature needs `S extends object` rather than `S extends JSONSchema`;
   the `as const` hazard and the type-level test that covers it; and egress
   validation turning "no persistence entity in a response body" from a rule into a
   checked property. **This is the ADR to write first if only one gets written.**

If time runs short, collapse into one "Design decisions" section in the README.

**`docs/residual-risk-catalogue.md`** — the doctrine made visible. Absorbs what rev 3
called the gap register. See section 12a.

**`docs/spec-changes.md`** — three forced, two corrective, the two promoted
unsatisfiability findings, the rest as observations. A strong artefact: it
demonstrates the spec was read properly rather than skimmed for endpoints.
Noticing that a specification is internally unsatisfiable is a better signal than
noticing that it has copy-pasted descriptions.

---

## 12a. `docs/residual-risk-catalogue.md`

**Purpose.** Every decision taken in the interest of time, safety or scope, stated
as a decision rather than discovered as a gap. It converts "he didn't do X" into
"he decided not to do X, priced it, and knows what closes it".

**Shape.** A severity/likelihood table at the top, then one short entry each:

- **What I chose** — one sentence.
- **What it costs** — the concrete consequence, with a number where one exists.
- **How you would trigger it** — the specific sequence. This is what separates
  the document from a list of regrets.
- **What closes it** — the fix, and roughly what it would cost.

**Rules.** No entry without a trigger and a fix — if neither exists it is a note
for the README, not a risk. Written _as decisions are taken_, not reconstructed
on evening 3. Entries earned during the build carry more weight than entries
predicted before it, so timestamp nothing but do keep them in the order they were
taken.

**Opening set, all already earned:** the `F10` status window and the `FOR UPDATE`
variant; deferred `PATCH`/`DELETE` and the note that deferring account deletion
is what hides `F10`; idempotency keys on transaction creation (_have this one
most ready — it is the likeliest extension_); pagination on the transaction list;
soft delete and audit trail; rate limiting or lockout on auth; the 403/404
information leak (403 confirms existence; 404 everywhere is the
security-conservative choice; implemented as specified); £0 transactions
permitted per spec against my own preference; the balance ceiling deviation;
bcrypt at ~50ms serialised and ~20 logins/second/process; the Ajv custom-keyword
alternative to `toPennies`; test-suite connection scaling under `isolate: true`;
handler-adapter limits (no streaming, no custom headers, JSON only); the
concurrency test if unbuilt, with its design; and where mechanisation stops —
which section 3 invariants could move to deterministic tooling and which cannot.

---

## 13. Repository setup

- **Name:** `ledger-api`. Not `eagle-bank-api` — that phrase is searchable and
  identifies the exercise.
- **Visibility:** public as required
- **The probe branches stay, and are referenced deliberately.** Decided in rev 5.
  Both `probe-ledger-api-brief` and `probe-ledger-api-brief-2nd-run` are public on
  the repository that will be submitted, and the second's `README.md` and
  `FINDINGS.md` contain "take-home", "interview", "pair-coding session" and "the
  real 12-hour build". No company name and no "Eagle Bank", so this is not a
  disclosure problem — but it _is_ a partial exception to the bullet above, taken
  knowingly because the methodology is the strongest thing in the submission and
  hiding the evidence for it would be perverse. Two requirements follow:
  - **The README links them**, under a short heading, so the reviewer finds them
    on purpose rather than by wandering. Being seen to have hidden them is the
    only genuinely bad outcome here.
  - **Scrub the exercise-identifying phrases** from `FINDINGS.md` and the probe
    `README.md` before submission — "take-home", "interview", "pair-coding
    session", "the real 12-hour build", "a take-home will never collide". Every
    one has a neutral rewrite ("the build", "the review session", "at this
    scale") that costs nothing and loses no meaning. The methodology survives the
    scrub entirely; only the searchability goes.
- `pnpm-lock.yaml` **and** `pnpm-workspace.yaml` committed — the second is not
  optional, it is what stops `F1` reaching the reviewer.
  `pnpm install --frozen-lockfile` in CI with `pnpm audit` as a separate step.

---

## 14. Known unknowns

Substantially shorter than rev 3 — the probe closed most of them. **Closed
favourably:** async middleware error propagation; the four-library seam at
runtime; suite time (~6s for 101 tests with full database integration);
devcontainer compose; test-isolation defaults. **Closed unfavourably and now
handled above:** `F7`'s typecheck seam, `F10`'s status bug, `F1`/`F2`'s step-0
sinks.

What genuinely remains:

- ~~Whether the real `isJsonValidRz` reproduces `F7`.~~ **Closed favourably, and
  better than expected:** the second probe round found a signature that infers the
  type from the schema, verified project-wide at the pinned lockfile. `F7`'s
  conclusion is retracted, step 0b is a port rather than a spike, and the residual
  is the `as const` hazard rather than a two-hour refactor.
- **Whether ~12 hours is enough**, and whether the section 9 drop ordering
  survives contact. Judgement, not a claim; not probeable.
- **The reviewer's cold start.** Rehearsed in step 8 rather than probed.
- **JWT end-to-end** — expiry, clock skew, `alg: none` rejection. Only payload
  shape and async-middleware propagation have been checked.
- **Whether the handler adapter is an improvement on `.match()` at every
  handler**, given that `.match()`-everywhere is my established idiom rather than
  a style I would be adopting. Section 5 argues it is a de-duplication rather than
  a departure, but that is an argument, not a measurement. This is a falsifiable
  claim and therefore a legitimate 20-minute probe under section 2a — write one
  endpoint both ways and compare what each makes impossible.

---

---

# Addenda — decided during the build, after rev 6

**Everything above this line is rev 6 as written before the build began, and is not
edited.** That is deliberate rather than sentimental: `docs/divergences.md` records
where the build departed from this document entry by entry, and those records are only
checkable while the text they refer to stays put. Edit the body and the falsification
log loses its referent. So the body is frozen and everything decided afterwards
accumulates here.

**Append only. One section, at the end, nothing threaded through the body above.**

Where a decision is already written into a repository document, this section points at
it rather than restating it. Two copies of a decision are two things that can drift.

---

## A1 — Extensibility is a stated goal, not an emergent property

**Affects steps 4 through 8. Standing.**

The requirements accompanying the specification provide for a follow-up session whose
stated purpose is _extending_ the solution. So "can an endpoint be added without new
machinery" is not polish a reviewer might happen to notice. It is close to being the
activity under assessment, and it should be designed for rather than hoped for.

Two consequences, and the second answers a question section 9 leaves open:

- **It raises the weight of the keystone.** Step 4 establishes the pattern every later
  endpoint copies. If that pattern is also copied live, at speed, by someone who did not
  write it, then "a clear idiom repeated correctly" is not good enough where a shared
  mechanism would do. See A2.
- **It retrospectively justifies correcting the specification for deferred endpoints.**
  A fully corrected document makes adding a deferred endpoint an _implementation_ task.
  Left uncorrected, the same exercise opens with specification archaeology. This is a
  better argument than the theoretical one — that the corrections would be vindicated if
  we ever got there — because it pays off whether or not the endpoint is ever built.

> **Amended at step 1 — a third consequence, and it has to be distinguished from A4.**
>
> If the follow-up session is close to being the activity under assessment, then **what is
> left unbuilt is a design input rather than a leftover.** Machinery with no consumer yet —
> the authenticated adapter variant before an authenticator exists, an error kind before
> anything raises it — is not owed to a step merely because a section header lists it
> there. Pre-building it costs twice: it removes an activity from the session, and it
> leaves exported constructors with no call site, which reads as speculative machinery to a
> reviewer who never attends one.
>
> **This is not A4's declined bet, and the difference is the whole point.** A4 declined
> leaving `GET /v1/accounts` specified-but-unbuilt, because that is a hole in section 9's
> scope and a reviewer may read it as incompleteness rather than staging. Not-yet-needed
> plumbing is not a hole: the scope is unaffected, every endpoint still ships, and the only
> question is which step builds it. A4 stands as written.
>
> **The test for whether deferring is safe is a mechanism, not a promise.** An error kind
> defers safely because the renderer's `never` default branch turns adding one into a
> single compile error at a known location. Where the deferral would instead be silent,
> build it now. The same discriminator settled the specification in one pass at 0c — that
> work was inevitable and no later insight would revise it, so staging it bought nothing.

**This reasoning cannot be written into the repository.** The phrase naming the session
is on the `commit-msg` denylist, and the framing identifies the exercise regardless of
wording. The repository states the goal on its own terms only — _this service is expected
to grow, and adding an endpoint should require no new machinery_ — which is true and
defensible standing alone. The motivation stays here. What reaches `docs/divergences.md`
is the staging rule in neutral terms: **machinery arrives with the step that consumes it.**

---

## A2 — Ownership authorisation is shared; route bodies are not

**Affects steps 4 and 5. Built concretely at 4, extracted at 5.**

Resolve-then-authorise is the step where getting it wrong is both easy and invisible:
403 where the specification says 404 looks correct and passes a happy-path test. Under
A1 it will also be reproduced by someone working quickly. So it becomes **one function**,
not an idiom repeated five times.

> **Amended.** This entry first said "extracted within step 4". That was wrong, and the
> reason is worth keeping because it generalises.
>
> The near-miss was assuming `GET /v1/users/{userId}` has a _degenerate_ ownership check
> because a user owns itself. It does not — it instantiates the general shape exactly
> (resolve, 404 if absent, compare owner, 403 if foreign), with `ownerId` happening to be
> `id`. So the objection is not that the keystone is unrepresentative.
>
> The objection is arithmetic: **with one instance you cannot tell which parts of a
> pattern are general and which are incidental.** Extracting from a single case is
> guessing at an abstraction and then having the second case bend to fit it.
> `GET /v1/accounts/{accountNumber}` at step 5 is the second real case, and step 5 is
> never dropped under section 9. Build 4 concretely, extract at 5.

The cost is that step 5 does double duty — a new endpoint plus a refactor — and that if
time runs out mid-step the repository contains the duplication rather than the
abstraction. Accepted: duplication between two endpoints is legible, and a wrong shared
function is not.

> **Amended at step 1's review. The acceptance above is withdrawn.**
>
> "Duplication between two endpoints is legible" is true for a reader and false for
> someone reproducing the pattern at speed under observation. Resolve-then-authorise is
> the one place where getting it wrong is invisible: 403 where the specification says 404
> looks correct and passes a happy-path test. A shared function is _called_; a pattern is
> _reproduced_, and reproduction is where that mistake enters.
>
> So the extraction is **not droppable**. If step 5 runs short, what gives way is an
> endpoint, not the refactor — and A5 has already spent both of the cheap ones, which
> makes this the harder commitment rather than the easier one.
>
> **Re-examined at the same review and unchanged: the ceiling below stands.** The target
> is still _read two endpoints and write the third_, not a factory that makes the third
> three lines of configuration. Raising the extraction's status does not raise the
> ceiling, and the two are easy to confuse.

**And this is where sharing stops — the caution matters as much as the decision.** There
is a version of this goal that produces a generic resource-endpoint factory, where a new
endpoint is three lines of configuration. That is worse on every axis that counts here:
it looks clever, it is harder to explain unprompted, and a reviewer cannot tell what it
does without reading the machinery. Section 0 rule 3 rules it out directly.

The target is **obvious repetition of a clear pattern** — read two endpoints and you can
write the third — not a mechanism that makes the third trivial. Some duplication between
route bodies is legibility, not debt.

---

## A3 — The README gains an "adding an endpoint" walkthrough

**Affects step 8. New deliverable, roughly twenty minutes.**

Four numbered steps with file pointers: ingress schema, response schema, service method
returning a `Result`, register the route with the authenticated adapter. It states A1's
goal in the neutral terms A1 requires, and it answers the extension question directly
instead of leaving a reader to infer the answer from six similar files.

Section 12 says to resist a fifth document. This is not one — it is a section of the
README, which section 12 already lists.

> **Amended at step 1's review. It moves from step 8 to step 4, and it acquires a test.**
>
> Written at step 8 it is post-hoc for every endpoint and nothing checks it. **The floor
> is step 4**, and not earlier: the walkthrough's central line points at `authedHandler`,
> which exists from step 3 but has no caller until step 4 — and a README naming machinery
> nothing uses is worse than code doing the same, because a reader cannot see the absence.
> Step 4 is also the first endpoint instantiating the whole shape; `POST /v1/users` is
> unauthenticated and login returns a token rather than a resource.
>
> **Written at 4, revised at 5, falsified at 6.**
>
> - At **step 4** the ownership step reads as prose: resolve, 404 if absent, compare
>   owner, 403 if foreign.
> - At **step 5** that paragraph becomes a call to the extracted function. The edit is
>   small, and it is the visible evidence that the document tracks the code rather than
>   having been written once and abandoned.
> - At **step 6**, build both transaction endpoints _through_ it, touching only the files
>   it names. **Any file you have to touch that the walkthrough does not name is a defect
>   in the walkthrough, not an exception to it.** That is what turns "adding an endpoint
>   requires no new machinery" from a promise into something tried twice before
>   submission.
>
> Four of the seven delivered endpoints then exercise it, against two if it were written
> at step 5. Its worked example is `GET /v1/accounts`, which is unbuilt at every one of
> those points — see A5.

---

## A4 — Roadmap revisions that follow from A1

**Affects steps 0d, 0e and 1. Section 10's ordering is unchanged; its emphasis is not.**

Nothing below drops or reorders a step. A1 changes which steps carry the weight, and
three of them were mis-weighted by a plan written before the goal was stated.

**Step 1 is promoted from groundwork to the most important step in the build.** It
bundles the error envelope, the handler adapter, `toPennies`, `currencyScale` and
observability, and section 10 sequences it as plumbing to get through before the
endpoints start. But the adapter **is** the extension surface: every claim that an
endpoint is cheap to add is cashed there, and steps 2 through 6 are largely repetition of
whatever shape it establishes. It gets the close review, ahead of steps 2 and 3.

**Step 0d carries no tables.** Connection, migrator, reset helper, and one trivial
migration proving the pipeline. Each table arrives with the step that reads it.

Two reasons, and the second is the one that decided it. A migration nothing reads
produces a suite that is green without asserting anything. And the migrations are where
the money representation and the trigger-maintained timestamps are actually decided —
`INTEGER` rather than int8 or `numeric` because both of those return strings and make the
Kysely declaration a lie `strict: true` cannot catch, and `ColumnType<Date, never, never>`
because it is what makes an application-side timestamp write a compile error. Those are
domain decisions. Putting them inside the one step everybody agrees is boilerplate is how
they get waved through.

It also makes "an endpoint brings its own migration" the established pattern rather than
a special case, which is what A1 wants.

**The composition root is decided at step 0e, not step 1.** 0e registers the first route,
so its registration shape is the one every later route copies — including one written
live. One place, one line per route, no indirection. Deciding it is a minute; inheriting
it is permanent.

### One option considered and declined

Deliberately leaving `GET /v1/accounts` unbuilt but fully specified, as a zero-new-concepts
endpoint to add live.

Declined. It trades a real deliverable for a hypothetical session, and if that session
does not happen — or if a reviewer reads the gap as incompleteness rather than staging —
the bet loses twice. Build everything in section 9's scope, and have the README name which
deferred endpoint is cheapest to add and why. Same signal, no wager.

> **Reversed by A5. Do not read this section on its own.** The decision above stood while
> the follow-up session was hypothetical; it is now what the scope is planned around, so
> the wager is not a wager. `GET /v1/accounts` is deliberately unbuilt. A5 answers the
> second objection above — that a reviewer may read the gap as incompleteness — rather
> than dismissing it.

### What does not change

Section 9's drop ordering. Under time pressure the compression comes from keeping 0e
minimal and not gold-plating steps 2 and 3 — not from sacrificing something different
from what was already decided.

---

## A5 — The delivery scope, and what is deliberately left unbuilt

**Affects steps 5 through 8. Supersedes section 9's endpoint list and its drop ordering.**

Seven endpoints are delivered and two are not.

|               |                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Delivered** | `POST /v1/users`, `GET /v1/users/{userId}`, `POST /v1/auth/login`, `POST /v1/accounts`, `GET /v1/accounts/{accountNumber}`, `POST .../transactions`, `GET .../transactions/{transactionId}` |
| **Deferred**  | `GET /v1/accounts`, `GET .../transactions`                                                                                                                                                  |

**This reverses A4's declined option, and the reversal is deliberate rather than
forgetful.** A4 considered leaving `GET /v1/accounts` specified-but-unbuilt and declined
it, because it trades a real deliverable for a hypothetical session and loses twice if
that session does not happen. The session is now what the entire scope is planned around,
so the bet is no longer a bet. A4's _second_ objection still stands and is answered rather
than dismissed: a reviewer may read a gap as incompleteness, so the README walkthrough
(A3) uses this exact endpoint as its worked example. The gap becomes the thing the
documentation explains rather than the thing it omits.

**Transactions are not droppable, and it is the requirements that say so rather than the
design.** `coding-test.txt` states the floor directly — _"We do not expect all the
endpoints to be completed for submission but at least we expect some of the basic
operations to be ready (ie, Create and Fetch for User, Account and Transaction)."_ That
names Transaction. This is the blind-spot ruling working exactly as it predicts: the
sentence lives only in the requirements, and a plan reasoning from the specification
misses it. Section 9 arrives at the same place independently — never the transaction
slice.

The trim is to create-and-fetch, which is the requirement's own wording. The transaction
list goes with the account list.

**The sharper reason the slice cannot be dropped is that its analysis is already
delivered.** R1 sets out the withdrawal race in full, section 7 carries the corrected 422
justification, and `debitIfSufficient` is a closed decision. A reviewer can see that the
thinking happened. Absent code does not read as _not reached_ beside that; it reads as the
one part that was started and not finished.

**The concurrency test is restored to the plan.** Section 9 lists it third in the drop
ordering, and that was wrong twice over. It is a _correctness_ test rather than a
performance one — two £100 withdrawals against £100 must yield one success, one 422, a
zero balance and exactly one transaction row — and R15's entire basis is those tests, so
dropping them does not reword that entry, it inverts it. The anticipated flakiness is also
unlikely: under READ COMMITTED, Postgres blocks the second `UPDATE` and re-evaluates its
`WHERE` clause once the first commits, so the outcome is settled by the database rather
than by scheduling luck.

**What absorbs the pressure instead.** The drop ordering is now JWT sophistication first,
then the two list endpoints — both already spent here. Beyond that, step 7's separate
sad-path sweep folds into each endpoint as it is built, since section 3 already requires a
sad-path test per endpoint and a dedicated pass is mostly re-reading. Step 8 is timeboxed
rather than trimmed; it is the half section 9 says never to drop.

### The revised roadmap, consolidated — and this table is the one to read

**Section 10's step _ordering_ is unchanged. Four of its steps now carry different
content**, and reassembling that from A2, A3, A4 and the paragraphs above is exactly the
archaeology this project objects to elsewhere. So it is written out once, here.

| Step  | Delivers                                                                                                                                           | Changed from section 10                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **2** | `POST /v1/users` — migration and trigger, repository port, service layer, bcryptjs, the 409, and **the adapter's response-schema parameter** (§8c) | Unchanged                                                                                                                                                    |
| **3** | `POST /v1/auth/login`, JWT issue and verify, **`authedHandler`**                                                                                   | The signing key is generated per process and never configured — R32                                                                                          |
| **4** | `GET /v1/users/{userId}` with the ownership check, **and the README walkthrough**                                                                  | **The walkthrough moves here from step 8** — A3 as amended. This is the earliest step at which every move it names exists and is used                        |
| **5** | `POST /v1/accounts`, `GET /v1/accounts/{accountNumber}`, **and the ownership extraction**                                                          | `GET /v1/accounts` is **not** built. The extraction is **not droppable** — A2 as amended. The walkthrough's ownership paragraph becomes a function call here |
| **6** | `POST .../transactions`, `GET .../transactions/{transactionId}`, **built through the walkthrough rather than alongside it**                        | The transaction list is **not** built. Any file touched that the walkthrough does not name is a defect in the walkthrough — A3                               |
| **7** | The concurrency test                                                                                                                               | **Restored** from the drop list. The separate sad-path sweep is gone, folded into each step above                                                            |
| **8** | README dependency table, ADRs, a final pass over the catalogue and spec-changes, cold-start rehearsal                                              | Timeboxed rather than trimmed                                                                                                                                |

**The two things that moved earlier are the ones most at risk of drifting back.** The
walkthrough at step 4 and the ownership extraction at step 5 are both scheduled before the
point at which they would feel necessary, and both are there for the same reason: each is
tested by the endpoints built after it, and neither can be tested at all if it arrives
last. A walkthrough written at step 8 is post-hoc for seven endpoints and checked by none.

---

## Corrections recorded elsewhere, referenced rather than repeated

Measurement has overturned something in every slice so far. Those corrections live in
the repository documents and are **not** restated here:

- **Step 0a** — the `allowBuilds` entry, and R18's trigger sentence.
  `docs/divergences.md` § Slice 0a.
- **Step 0b** — the causal account of TS2589; the error union's cardinality is not a
  term. `docs/divergences.md` § Slice 0b.
- **Step 0c** — the `403` description note (ten responses, five naming the wrong
  operation, rather than "seven copy-pasted"); `CreateTransactionRequest.amount` declares
  `maximum: 10000.00` rather than `maximum: 10000`, corrected in R9 as well.
  `docs/divergences.md` § Slice 0c.
- **Step 0c, a departure from this brief** — section 6 forced change 1 calls for a
  `password` field on `UpdateUserRequest` as well as `CreateUserRequest`. Only the second
  was taken; adding one to the update schema would publish a design rather than repair a
  defect. `docs/spec-changes.md`, and `docs/divergences.md` § Slice 0c.
- **Step 0c, provenance** — the login endpoint and the credential field are instructed by
  the accompanying requirements, not inferred from `bearerAuth` in the specification. The
  distinction matters because only the second would be a finding of mine.
  `docs/spec-changes.md`.

---

## A6 — The delivery plan revised at step 2's review, and it is the plan to follow

**Affects steps 3 through 8. Supersedes A5's step _granularity_, not its scope.** A5's
endpoint list is unchanged and is still the record of what is delivered. What changes is
how many passes it takes and how much process each pass carries.

**Why.** Step 2 cost more than the plan assumed. The breakdown, because the shape of the
cost decides what to cut: orienting from the documents before writing anything; three
layers established at once; two falsification passes plus three further measurements; the
write-ups; and a real share of rework. Almost none of the _machinery_ cost recurs — the
adapter's egress parameter, the configuration pattern, the error-kind tables, the
per-test truncate, the type-assertion idiom and the repo/service/schema template are each
built once. A later endpoint is an ingress schema, a response schema, a repository method,
a service method, a route line and its tests.

**The load is not evenly spread over what remains, and this is the whole basis of the
plan.** Two slices carry real design content — **step 3**, whose machinery is entirely new
and which everything after it depends on, and **step 6**, where the withdrawal, R1 and
section 7's corrected 422 all land. Steps 4 and 5 are the same shape twice. Step 7 is one
test. So the remaining work is two hard slices and some copying, not six of what step 2
was.

### The revised sequence

| Pass  | Delivers                                                                                                                                                         | Depth                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **A** | Step 3 — `POST /v1/auth/login`, JWT issue and verify, `authedHandler`                                                                                            | **Full.** New machinery, and the JWT payload is validated as untrusted input — a section 3 invariant                       |
| **B** | Steps 4 and 5 together — `GET /v1/users/{userId}`, the README walkthrough, `POST /v1/accounts`, `GET /v1/accounts/{accountNumber}`, and the ownership extraction | Template, with one exception: the ownership semantics get full attention                                                   |
| **C** | Steps 6 and 7 together — both transaction endpoints and the concurrency test                                                                                     | **Full.** The concurrency test is a test of step 6's endpoint and was never a separate slice in anything but the numbering |
| **D** | Step 8                                                                                                                                                           | Timeboxed, and trimmed as below                                                                                            |

**Folding 4 and 5 does not weaken A2.** A2 requires the extraction to follow a second real
case, not to follow a session boundary: build `GET /v1/users/{userId}` concretely, build
`GET /v1/accounts/{accountNumber}`, then extract from the two. That ordering is preserved
inside pass B. A2's amendment stands in full — **the extraction is still not droppable**,
and under R37 it matters more rather than less, because a shared function is the only
mechanism available for a decision no test shape can check.

### What each pass drops, and it is process rather than scope

- **The reference is not consulted at passes A or B.** It has been diffed twice against the
  same service/repository/handler pattern and the returns are visibly diminishing; step 2's
  twelve-row table produced three findings, all in the egress half. It **is** consulted at
  pass C, where `debitIfSufficient` and the transaction boundary are content nothing else
  in this project covers. `docs/divergences.md` records for each undiffed slice that it was
  not diffed, so a gap is never mistaken for a clean comparison.
- **Template slices get a short write-up.** Departures and sad paths, not a falsification
  narrative. The full treatment is reserved for passes A and C.
- **Step 8's ADRs become an index rather than new prose.** Section 12 asks for ADRs, and
  writing them now means restating decisions that already live in
  `docs/residual-risk-catalogue.md` (37 entries), `docs/divergences.md` (per slice) and
  `docs/spec-changes.md`. Restating them is the duplication this project objects to
  everywhere else and creates copies free to drift. A one-page index — the decision, one
  line, and where its reasoning lives — is the deliverable. **This is a departure from
  section 12 and is recorded as one.**
- **JWT sophistication is the named gap.** No refresh, no revocation, no rotation, minimal
  claims, key generated per process. A5 already puts this first in the drop ordering and
  R32 carries the key decision. It is the one place a real gap is left in the _code_ rather
  than in the process.

### What is not cut, and why the list is short

**The endpoint scope.** It already sits at the floor the requirements name — Create and
Fetch for User, Account and Transaction — and A5 has spent both of the cheap deferrals.
Cutting an endpoint now breaks a stated requirement rather than leaving a recorded gap,
which is a different kind of hole and a worse one.

**One sad-path test per endpoint** (section 3), **the ownership extraction** (A2), **the
README walkthrough at step 4** (A3 — written later it is post-hoc and nothing checks it),
and **the cold-start rehearsal** (it is the reviewer's first command, and it is cheap).

### The change this plan is a response to

Review capacity ran out at step 2. **R37** records what that means for assurance and which
guardrails are load-bearing without a reader. Read it before pass B, because it names the
three most semantics-dependent decisions left — the ownership check, its extraction, and
the withdrawal's 404-versus-422 — and all three arrive after the reading that would have
caught a mistake in them.
