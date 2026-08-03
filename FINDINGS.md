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
| F7 | The Ajv + json-schema-to-ts + neverthrow seam does not typecheck in its natural shape | **High — §14's predicted seam** |
| F8 | The linter advises a change that silently breaks the error handler | Moderate |

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

## F7 — the Ajv + json-schema-to-ts + neverthrow seam does not typecheck in its natural shape

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

**The shape that does work** is to stop inferring the type from the schema and
name it at the call site:

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
