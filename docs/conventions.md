# Conventions

Standing rules, unlike `divergences.md` which is a build-time working document. A rule
earns a place here only if a reader could not infer it from the code, and only if
breaking it would be invisible rather than loud.

---

## Naming: `Rz` marks a `Result`

This service is errors-as-values. Failure is not a control-flow event, it is a value
sitting in a variable, and a value that looks ordinary is one a reader can forget to
unwrap. The names carry the distinction the type system knows but the reading eye does
not.

### The rule

| Suffix | Means | Example |
|---|---|---|
| `…Rz` | The thing **is** a `Result` | `signupRz` |
| `…RzA` | The thing **is** a `ResultAsync` | `accountRzA` |
| `…_…Rz` | The thing is **not** a `Result`, but yields one when called | `get_appIdRz` |
| `…_…RzA` | Not a `ResultAsync`, but yields one when called | `find_accountRzA` |

The underscore is the whole mechanism: it separates what you do from what you get. Read
`get_appIdRz` as "get, and what comes back is a `Result` of an app id". Read `appIdRz` as
"this already is that `Result`". The first must be called; the second must be unwrapped.
Confusing the two is the mistake the suffix exists to make impossible to make silently.

Type aliases follow the same rule when the alias IS a `Result` —
`type SignupRz = Result<SignupBody, DomainError>`.

### What is NOT marked, and why the exclusions matter

**Values inside a `Result` are not marked.** `signupRz.map((signup) => …)` — the callback
parameter is a plain `SignupBody`, because unwrapping is exactly what `map` did. A marked
name there would be a lie about a value that is no longer wrapped.

**Domain error types are not marked.** `ValidationFailed`, `DomainError` and `FieldError`
are the payloads that go INTO the error channel; they are not Results. `validationFailed`
returns a bare `ValidationFailed`, and the caller wraps it in `err()`. So it takes no
suffix and no underscore. If it were renamed `validationFailed_Rz` it would promise a
`Result` it does not produce.

**Factories are not marked.** `validatorFor(schema)` returns a *function*, and only that
function returns a `Result`. It is two steps removed, so neither marker fits. Deliberately
not given a third marker of its own: the convention answers one question — *must I unwrap
this?* — and for a factory the answer is "no, you call it". The thing you get back is
named at the binding site, where the marker does appear. Encoding arity into names is the
signature's job, and it already does it.

### Why this is worth the ugliness

It is ugly. An underscore mid-identifier fights every other name in the codebase, and
that is the point — it should be visible at a glance rather than blend in.

### It is enforced, not reviewed

`eslint-rules/result-binding-must-have-rz-suffix.mjs`, registered in `eslint.config.mjs`
against `**/*.ts` and run by `pnpm lint`. It is **type-aware**, which is what makes it
worth having rather than a spelling nuisance: the binding's resolved type is the entire
classification, so there are no producer lists to maintain, no factory-name exclusions
and no callee-name heuristics. The type checker has already decided whether a call, a
chained combinator or an annotation yields a `Result`, and the rule reads that answer.

Two consequences worth stating, because they are the reason the type-aware version is
better than a regex over names:

- **The factory exclusion is free.** `validatorFor` needs no special case. It returns a
  function, and a function is not a `Result`, so the rule never looks twice.
- **Combinator chains are covered without being enumerated.** `signupRz.andThen(…)`
  bound to a new name is still a `Result` by its type, so it is still checked.

Verified in both directions rather than assumed: with the suffix removed from a real
binding in `validator-for.test.ts`, `pnpm lint` fails naming that line; restored, it
passes. The rule's own cases run under `pnpm test`, and cover both directions —
including one that pins a gap rather than blessing it.

### What the rule does NOT cover

Stated so the gap is known rather than discovered. See **R28**.

- **It cannot see a missing underscore.** `getAppIdRz` — a function returning a `Result`,
  spelled without the `_` — passes, because the producer half of the convention is a
  claim about a function's *return* type, not about the type of the binding. That half
  stays a convention.
- **It does not close R17.** A `Result` created and discarded is invisible to it: the
  rule visits bindings and parameters, and a discarded `Result` has no binding to visit.
  R17 needs a rule that inspects expression statements. Different rule, still unbuilt.
- **A union mixing sync and async is not classified at all.**
  `Result<T, E> | ResultAsync<T, E>` hits the ambiguity guard, which declines to pick a
  side and therefore reports nothing — so such a binding passes under any name. Nobody
  writes that union on purpose, which is why the guard is defensible, but it is the one
  path where the rule is silent rather than wrong, and silence is what this rule exists
  to remove. Pinned by a `valid` case in the rule's test so the behaviour is recorded
  rather than assumed.
- **Destructuring is out of scope by design**, since attribution to a single `Result` is
  unclear.
- **Only `let`/`const` bindings and function parameters are visited** — not class
  properties or object literal members. Nothing in the codebase has those yet; services
  and repositories will.

### On establishing it at this point

The convention is being adopted while the Result-shaped surface is three bindings in one
test file. That is the argument for doing it now rather than the argument against: every
service method, every repository call and the handler adapter will return Results, so the
cost of retrofitting only grows from here. Adopted at the cheapest moment it could have
been.

### One name this rule already corrected

`validatorFor` was `isJsonValidRz`, and the suffix was wrong rather than merely
decorative — a bare `Rz` claimed the function IS a `Result` when it is a factory two
levels away from one. The predicate/factory mismatch was noticed first; the misapplied
suffix was the more serious defect and was only visible once this rule was written down.
Recorded in `divergences.md` § Slice 0b and in R26.

---

## Comments: earn the line or delete it

The test this document applies to itself applies to comments too — *could a reader infer
it from the code, and would breaking it be invisible or loud?* A comment earns its place
only when breaking the thing it describes would otherwise pass unnoticed.

Four ways a comment fails that test. All four were found in this codebase and deleted,
which is the reason the list is specific rather than general advice.

**It justifies its own timing.** "Enabled at the outset because the cost is
front-loaded" is an argument about *when* a decision was taken, and it stops carrying
meaning as soon as the decision is no longer recent. That reasoning belongs in the
commit message, where a reader who wants it will already be looking.

**It justifies what a test enforces.** Ajv's `allErrors`, `coerceTypes` and
`removeAdditional` each carried a paragraph explaining the consequence of the opposite
setting. Flipping any one of them fails the suite, so those paragraphs were prose doing
a mechanism's job. The options now stand bare, above a single line saying that tests
enforce them.

**It explains a loud failure, or repeats an explanation from where the decision was
made.** Registering the naming rule globally throws an error that names the fix, so a
comment warning against it added nothing. And `.mjs`-rather-than-`.ts` is explained at
the top of `eslint.config.mjs`, where the choice is actually made — restating it beside
a glob in `vitest.config.ts` only created a second copy to go stale.

**It quotes a number that has to be maintained.** "the 139-package tree", "the rule's
own 22 cases" — both were wrong within a commit or two of being written. If the count
matters, compute it; if it does not, leave it out.

### Before commenting a config option, flip it

If a test fails when you flip it, the comment is redundant — the mechanism already says
what the prose would have said. If nothing fails, the option needs a test rather than a
paragraph.

This has paid twice. Flipping two `globalSetup` entries deleted most of a comment *and*
revealed a genuine gap that nothing covered. And a guard against a supposedly silent
failure was written, adopted, then deleted once measured, because every reachable failure
was already loud — the tests that remain exist to justify its absence. An argued omission
beats an unexamined defence.

### The counter-example, which is what makes the rule discriminating

`argsIgnorePattern: '^_'` keeps its comment and deserves to. The comment claims only
that the linter's suggested fix — delete the unused parameter — is wrong wherever a
function's arity is part of its contract. What earns it the line is that the linter
**actively advises the breaking change**, and the breakage is silent: remove such a
parameter and the code still compiles, still lints, and the run goes green. Nothing
announces it.

Note what that comment does *not* do, because it shows two of the rules above working
together. It does not name the case that will actually bite — an Express error handler,
which Express recognises purely by its having four parameters — because that code does
not exist yet, and naming it would be the first failure on this list. The general claim
is enough to stop the deletion. The specific consequence belongs beside the handler,
when there is a handler.

The distinction is not length, and it is not subject matter. It is whether the machine
will tell you.

### The handler now exists, and the reserved comment was not owed

The paragraph above reserved a comment for the error handler on the grounds that the
breakage would be silent. **Measured at the error-envelope slice, by deleting the fourth
parameter and running everything:**

| Check | What it said |
|---|---|
| `pnpm typecheck` | nothing — a three-parameter function is assignable to `ErrorRequestHandler`, so the annotation does not carry arity |
| `pnpm lint` | nothing |
| `pnpm test` | **seven failures**, one of them printing the HTML stack trace with absolute paths that the demotion reinstates |

So the breakage is silent to the tooling and loud in the suite. By the rule at the top of
this section the comment is redundant, and it was not written. The tests that cover the
error path are what stand in its place, which is the better outcome — an assertion cannot
go stale the way a sentence can.

**One thing this leaves open rather than settles.** It also weakens the case for the
`argsIgnorePattern` comment itself: removing that option makes `pnpm lint` fail naming
`_req` and `_next`, and taking the linter's advice from there fails the suite. Both steps
are now loud, where neither was when the comment was written. It is left in place rather
than deleted, because its claim is prospective — it is about any function whose arity is
part of its contract, including ones no test will exercise — and because deleting it is a
change to a slice already reviewed.

**Settled at the final pass, because an open question left in a document at submission is
worse than either answer.** The comment stays, and the second of the two reasons above is
not the one that decides it — "a slice already reviewed" is an argument about cost, and it
expires. The reason that holds is the first one. What the measurement established is that
the error handler *this repository has today* fails loudly when its fourth parameter goes;
it did not establish that every function whose arity is part of its contract would, and
the comment's claim is about those. The linter also still actively advises the deletion,
and no test can be written against advice — the suite can only object after someone has
taken it. So the counter-example above survives its own falsification with a narrower
basis than it was written with, which is recorded here rather than left as a loose end.

---

## Evidence: absence of an error is not evidence

**A rule that reports nothing is indistinguishable from a rule that is switched off.**
Before concluding that a check holds, make it fail: write the line that ought to be
rejected, watch the rejection, then remove it. Several mechanisms here are verified in
both directions for exactly this reason — the naming rule, the schema-inference assertion
and the payload ban each pin a failing case alongside a passing one.

**A claim in a document is worth testing too, including a claim in this one.** The
counter-example above survives because it was tested and found wrong in its most important
clause. A convention nobody has checked is one that is true until someone looks.

---

## Staging: machinery arrives with the step that consumes it

A module with no caller is not obviously wrong, which is what makes this a convention
rather than something a compiler settles. The question is not *does anything call it yet* —
plenty of correct code has a caller that arrives later. It is:

> **Would later work change its shape?**

If it would, building now means inventing a placeholder for a decision not yet taken, and
then having the real thing bend to fit it. If it would not, building now is free, and
sometimes better than free, because the alternative is doing it in a step that already has
enough happening.

Both answers are live here. `toPennies` was written before anything called it: its
behaviour is fixed by a published two-decimal-place rule and verified across every legal
amount, so nothing downstream can revise it. The authenticated half of the handler adapter
was deliberately *not* written ahead of the authenticator, because every one of its
parameter types is decided by code that did not exist yet.

**The safety condition is that the deferral is loud.** Deferring an error kind is safe
because the tables keyed on the union make adding one a compile error naming the missing
member. Where a deferral would instead be silent — where the thing simply never happens
and nothing reports it — build it now.

---

## Tests: a test may not assert structure into existence

A test posting to `/v1/users` before that route exists will pass, because body parsing
happens before routing and the path is never matched. It is still wrong: anyone reading
the suite concludes the endpoint is there.

This is the test-shaped version of the staging rule above, and it is the quieter of the
two. Unbuilt production machinery is at least visible as an export with no caller; an
unbuilt endpoint named in a passing test looks exactly like a built one.

**Use a path that is obviously not a route** wherever the path is incidental to what is
under test. It usually sharpens the claim rather than weakening it — asserting that a
malformed body is rejected at `/no-such-route` says the parser runs before routing, which
is the stronger property.

---

## Configuration: environment variables with defaults, and one value with none

Configurable values are read where they are used, through a function taking `env` with a
committed default — `src/db/connection.ts` is the pattern. There is no configuration
module; with four such values there is nothing for one to centralise. They are named
together in the README, along with the two that look configurable and deliberately are
not.

**Never branch on `NODE_ENV === 'test'`.** A value that must differ under test belongs in
an environment variable the test runner sets, not in a branch. A branch means the code the
suite exercises is not the code that runs, and exercising the second one is the suite's
entire purpose. `BCRYPT_COST` is where this tempts, since the cost genuinely must be lower
under test.

**There is no `.env` and no `.env.example`.** A connection string living only in an ignored
file is a string a fresh clone does not have, and an example file is a second copy of that
string, free to drift from the default in code. **R32** carries the reasoning, and the one
value none of this applies to.

---

## History: what a commit carries

**Only what the diff and the touched documents do not** — why now, what the act was, and
any departure from plan. A message that is nothing but a subject line is a legitimate
outcome of that rule rather than a lazy one, and several here are.

Subjects are plain imperative, with no `feat:`/`docs:` prefix and no trailers.

**Files arrive in final form.** A rename is never staged through an intermediate state, so
history contains no name that was never used.

**The full test suite runs in `pre-commit`, deliberately.** It needs Postgres running, from
the migration slice onward. The cost is seconds, and the alternative is committing
something that does not build.
