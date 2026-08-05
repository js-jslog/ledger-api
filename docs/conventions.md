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
