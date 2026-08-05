# Divergences

A build-time working document, not a deliverable. Each slice was attempted from the
design and the recorded evidence *before* the reference implementation was consulted;
this file accounts for each difference found afterwards in one line, as **deliberate**,
**equivalent**, or **I was wrong**.

The third category is the one worth having. Entries where the reference was better are
more valuable than entries where it was not.

---

## Slice 0a — toolchain

### Claim under test

> `allowBuilds` in `pnpm-workspace.yaml` is what unblocks the scripts.

**The falsification pass came back negative, and the config changed as a result.**

With `allowBuilds` removed and `node_modules` deleted, `pnpm typecheck`, `pnpm lint`
and `pnpm test` all passed. Cause: **no package in this 139-package tree declares a
`preinstall`, `install` or `postinstall` script at all.** vitest 4.1.10 transforms via
rolldown rather than esbuild, so the specific dependency the allowlist was written for
is not present.

So `allowBuilds: { esbuild: true }` would have been an allowlist entry for a package
this project does not install — dead configuration carrying a confident comment, which
is worse than no comment. It is now `allowBuilds: {}`, empty by measurement, with the
reasoning in the file.

**The mechanism is real, and was verified here rather than cited.** A throwaway local
dependency carrying a `postinstall` script was added to arm the gate. On pnpm 11.18.0,
with that package unlisted, `pnpm typecheck`, `pnpm lint` and `pnpm test` all failed
identically, deep inside `runDepsStatusCheck`, with nothing in the stack trace naming
the real cause. That is exactly the disproportionate failure mode the evidence
describes, so the comment stays — it documents a live hazard that is simply not
currently armed.

**One thing not verified, stated because the difference matters.** Allowlisting that
throwaway package by its bare name did *not* lift the gate — pnpm reported it as
`gate-probe@file:...`, so the key spelling for a `file:` dependency appears to differ.
The probe verified the fix for `esbuild`, a registry dependency. I have therefore
confirmed that the gate fires but not, first-hand, that the allowlist is the fix.
Recorded rather than glossed.

**Consequence for the catalogue.** R18's trigger sentence asserted that omitting
`pnpm-workspace.yaml` from the commit fails every script. That is not true for this
dependency set. Corrected in place, with the measurement, rather than left as a claim
a reviewer could falsify in thirty seconds.

### Second claim under test

> `fileParallelism: false` is load-bearing.

**Confirmed, and it is now a test rather than an assumption.** `test/toolchain` is a
deliberate pair of files that enter a shared critical section and assert no overlap.
With the setting in force: 2 passed, 623ms. Forced back on with
`vitest run --fileParallelism`: both files fail with
`"A entered while B was still inside"`, and wall clock drops to 333ms — the overlap
made visible.

**Divergence from the reference, deliberate.** The reference version of this experiment
*logs* enter/exit records to a file for a human to read, and asserts nothing. This
version asserts well-nesting, so it fails the suite rather than requiring someone to
notice. The reference was a probe establishing a fact once; this has to keep holding.
Two further seam changes: the log path comes from `os.tmpdir()` rather than being
baked in, so it runs on a reviewer's machine; and a `globalSetup` truncates it, so a
run is never judged on records left by the previous one.

### Other deliberate departures in 0a

- **`packageManager` is `pnpm@11.18.0`, exact, not the `pnpm@11.x` range the design
  specifies.** A range makes corepack resolve against the registry per invocation, so
  two machines can land on different pnpm 11 minors — which defeats the determinism
  the pin exists to provide. Raised and agreed before the change. The design's *intent*
  is served; its literal text is not.
- **`@types/node` pinned to the 24 line**, matching the Node 24 runtime, rather than
  the 26 a bare install resolves to. Types ahead of the runtime let `tsc` accept APIs
  that do not exist at execution time, which is the same class of defect as the lying
  `int8` column declaration the money design rejects.
- **`~6.0` rather than `^6` for TypeScript.** Verified deliberate, not incidental:
  typescript-eslint 8.65 declares `typescript@">=4.8.4 <6.1.0"`, so `^6` would permit
  6.1 and silently lose every type-aware rule. Bare `typescript` still resolves to
  **7.0.2** today, so the pin remains necessary rather than historical.

### Diff against the reference config, one line each

Consulted after the slice was built and green. The reference `migrations/` is left
unread — it belongs to slice 0d.

| Difference | Verdict |
|---|---|
| Reference pins `typescript: "^6.0.3"`; this uses `~6.0` | **Reference was wrong.** `^6.0.3` permits 6.1, and typescript-eslint declares `<6.1.0` and *hard-aborts* rather than warning. The reference is one TypeScript minor release away from silently losing every type-aware rule — including the `no-floating-promises` it explicitly enables. `~6.0` is the only spelling that expresses the actual constraint. |
| Reference has no `packageManager` field at all | **Reference was wrong**, against its own recorded finding. The pin is what makes the pnpm-version-dependent config keys reliable; the evidence argues for it and the code omits it. |
| Reference pins `@types/node: "^26.1.2"` | **Reference was wrong**, mildly. Types ahead of the runtime let `tsc` accept APIs that will not exist at execution time. Pinned to the 24 line here to match the runtime. |
| Reference sets `exactOptionalPropertyTypes: true` | **Deliberate departure, and the design already called it.** It is not part of `strict`, and `json-schema-to-ts` emits `line2?: string \| undefined`, which under that flag will not satisfy a repository input declaring `line2?: string`. The reference has friction waiting for it at exactly the seam this build has to cross. |
| Reference sets `isolate: false` | **Deliberate departure, per the design.** Collapses the run to one shared pool, which is cheaper, but leaks module state between files — a test that passes alone and fails in the suite. Traded the measurable cost for the unmeasurable one. R12. |
| Reference sets `noUncheckedIndexedAccess: true`; first attempt here omitted it | **I was wrong, and adopted it.** It was left out as unrequested strictness; on reflection it is cheap, and the error envelope reads `details[0]` while Ajv's `error.params` is a loose record. One destructuring default in `test/toolchain` was the entire cost. |
| Reference restates `no-floating-promises: 'error'` though the preset includes it | **Reference was better, and adopted.** A rule that owns an invariant should be visible in the config rather than inherited silently. If the preset ever drops it, the explicit line is what makes that noticeable. |
| Reference ignores `eslint.config.mjs`; this disables only the type-checked rules for `**/*.mjs` | **Equivalent, marginally better here.** The config file still gets syntactic linting instead of being exempt entirely. |
| Reference omits `js.configs.recommended` | **Deliberate.** Added here; strictly more checking for no cost. |
| Reference `include: ["src","migrations","probe","*.ts"]` vs `["src","test","migrations","vitest.config.ts"]` | **Equivalent.** Tests live in `test/` here rather than `probe/`, and the root glob is narrowed to the one file that exists. |
| Reference sets `esModuleInterop: true` | **Equivalent.** `module: nodenext` already implies it, and the design records that it does *not* solve the `ajv-formats` interop problem anyway. |
| Neither the reference nor its catalogue has a local ESLint rule; this build adds `eslint-rules/result-binding-must-have-rz-suffix.mjs` | **Deliberate addition, and it partly answers the reference's own open question.** The reference's R17 sizes a custom type-aware rule at "perhaps forty lines" and does not build one. This is not that rule — it enforces the `Rz` naming convention, not Result *handling* — but it proves the harness the estimate depended on: a local rule can read the type checker here and can be unit-tested. Cost recorded in R28: `eslint.config.mjs` must import it, so it is `.mjs` and outside `tsc`. |
| Reference has `dev: "tsx watch src/main.ts"` and a `tsx` dependency | **Outstanding, deferred to 0e.** Node 24 runs TypeScript natively, so `tsx` may be a dependency this build does not need — and every direct dependency has to be defensible in the README table. Decide when the entrypoint exists. |

### One thing to carry forward

The reference disables six `no-unsafe-*` rules for its probe tree, because `supertest`
types `res.body` as `any` and asserting on a response body is therefore "unsafe" by
those rules. Not needed yet — `supertest` arrives with the first endpoint. Noted so it
is a known cost at slice 1 rather than a surprise, and so the exemption stays scoped to
test files instead of being loosened globally.

---

## Slice 0b — the validation funnel

### Claim under test

> The type parameter must be constrained to `object` rather than to `JSONSchema`,
> because an unresolved `FromSchema<S>` distributed across the `JSONSchema` union,
> **multiplied by the seven-member error union**, inside `Result`, exceeds what the
> compiler can represent.

**The workaround is necessary. The explanation of why is wrong**, and it is wrong in
the direction that matters — it names a term that turns out to be irrelevant.

Six variants were compiled at the project's own TypeScript and library versions,
changing one thing at a time:

| Variant | Result |
|---|---|
| `S extends JSONSchema`, `Result<…, SevenMemberUnion>`, body builds `ok`/`err` | **TS2589 + TS2590** |
| `S extends JSONSchema`, `Result<…, OneMemberUnion>`, body builds `ok`/`err` | **TS2589 + TS2590** |
| `S extends JSONSchema`, returns bare `FromSchema<S>`, no wrapper | compiles |
| `S extends JSONSchema`, `Result<…>` declared but body casts through | compiles |
| `S extends JSONSchema`, `Result<…>`, body builds `ok` only | compiles |
| `S extends object`, `Result<…>`, body builds `ok`/`err` | compiles |

So:

- **The error union's cardinality is not a term.** One member blows up identically to
  seven. The stated multiplication does not exist.
- **`Result` alone is not the trigger either.** Declaring the return type is fine; so
  is returning only `ok`. The blowup needs the *union* of `Ok<T, never>` and
  `Err<never, E>` produced by two return paths to be checked for assignability against
  `Result<T, E>` while `T` is an unresolved `FromSchema<S>` over the `JSONSchema` union.
  The error is reported at the return-type annotation but is caused by the body.
- Substituting a hand-rolled `Box<A, B>` or a discriminated `Either<A, B>` for `Result`
  reproduces nothing on its own, so this is not a defect in `neverthrow`.

**The consequence is a step deleted from the plan.** The reason given for deferring
this check to the error-envelope slice was that the union would not be full-size until
then. Since size is not a factor, union growth cannot reintroduce the blowup, and there
is nothing to re-test later. Recorded because the deferral was argued for out loud and
should be withdrawn out loud.

### Diff against the reference, one line each

| Difference | Verdict |
|---|---|
| Reference writes `import { Ajv }`; the first attempt here cast a default import | **I was wrong.** Ajv publishes a named export beside the default, so the named import needs no cast at all. The natural `import Ajv from 'ajv'` fails with "not constructable" and invites a cast that is simply unnecessary. |
| Reference states `removeAdditional: false` and `useDefaults: false` though both are defaults | **Reference was better, adopted.** Both alternatives fail *silently* — one strips unknown keys instead of rejecting them, turning a mass-assignment attempt into a quietly accepted request. A security-relevant default is worth stating. |
| Reference handles `body === undefined` explicitly before reaching the schema | **Reference was better, adopted.** Ajv would say `must be object`, which is true and unhelpful. |
| Reference's field name for a nested unknown key is `isAdmin`; this build emits `address.isAdmin` | **Deliberate, and this build is more informative.** The reference correctly notes the JSON pointer alone names the wrong field, then drops the parent context entirely rather than combining the two. |
| Reference casts `ok(body as T)`; this build does not | **Equivalent, shape-dependent.** With the reference's positive-branch form the cast is required — the first attempt here hit exactly that. Returning early on failure narrows by elimination and needs none. The mechanism behind the asymmetry was not chased, because the working shape is clear and cheaper than the explanation. |
| Reference's `ajv` instance is exported; this one is module-private | **Outstanding.** The custom keyword registration and egress validation both need the same instance, so this has to open up in a later slice. Private until something needs it. |
| Reference carries `currencyScale`, `egressCheck`, `shapeOf`, and log-only arguments in this module | **Deliberate deferral, not omission.** Each belongs to a later slice, and pulling them forward would mean a half-built observability story with no renderer to consume it. |
| Reference names the helper `isJsonValidRz`; this build renames it to `validatorFor` | **Deliberate departure, and it reverses an earlier decision taken here.** The reference name is predicate-shaped because the reference helper *is* a direct call — it takes a precompiled `ValidateFunction`. This build compiles at module load and is therefore a factory over a schema, so the shape the name describes does not exist here. The old name was kept at first so that the code and the design conversation would share a word; withdrawn because that gap is paid once by a reader of R26, whereas the predicate/factory mismatch is paid at every call site. **The suffix turned out to be the worse half.** Writing down the `Rz` convention (`docs/conventions.md`) showed that a bare `Rz` asserts the thing IS a `Result`, while a function returning one takes an underscore — so `isJsonValidRz` was wrong by two levels of indirection, and wrong in the reference too, where the correct spelling is `isJsonValid_Rz`. A factory takes no marker at all. Reversible with the signature if R26 is ever closed. |

### Also confirmed

The `ajv-formats` interop cast is still required at 3.0.1 — one of the claims flagged
as least durable, checked at its point of use rather than adopted on trust. Nested
`additionalProperties: false`, `__proto__` rejected as an unknown key without
prototype pollution, and `coerceTypes: false` refusing `"1000"` for a number all
behave as described, and are now asserted by tests rather than believed.

---

## Slice 0c — specification changes

### Claim under test

> The design's inventory of defects in the supplied document: three forced, two
> corrective, two promoted unsatisfiability findings, and a set of observations.

**Negative for the third slice running.** The inventory is substantially right and two
of its counts are wrong. Both were checked by parsing the document rather than reading
it, which is the only reason either was found.

**The `403` note is wrong in both directions.** It reads "the seven copy-pasted 403
descriptions", filed as cosmetic. There are **ten** `403` responses, and the problem is
not duplication: **five of them describe a different operation than the one they sit
on.** `POST /v1/accounts` and all three `/v1/users/{userId}` operations say the user is
"not allowed to access the transaction", and `POST .../transactions` — a create — says
"not allowed to delete the bank account details". Only one of the five sites mentioning
a transaction concerns one. Still not edited, and still cosmetic in the sense that it
changes no behaviour, but "copy-pasted onto similar operations" and "names the wrong
operation entirely" are different observations, and the second is the one worth being
able to show.

**`CreateTransactionRequest.amount` declares `maximum: 10000.00`, not `maximum: 10000`.**
The design states the two ceilings in different notations, which reads as though the
mismatch between them is part of the defect. It is not — the two values are numerically
identical, and the unsatisfiability comes entirely from *two* legal deposits summing past
a ceiling that applies to the balance. The argument is unaffected; the transcription was
wrong and R9 repeated it. Corrected in both.

**Everything else in the inventory held**, and was verified rather than accepted:

| Claim | Verified how | Result |
|---|---|---|
| Six `format:` keywords hold regexes, confined to `components.schemas` | Enumerated; every component schema then compiled under `strict: true` | Exactly six, all six named correctly |
| `strict: false` is the wrong workaround | Compiled the same schema both ways | `strict: false` validates `"GARBAGE"` as an account number |
| `^tan-[A-Za-z0-9]$` rejects the document's own example | Regex, and the character class enumerated | Rejects `tan-123abc`; admits exactly **62** ids |
| `POST /v1/users` is the only `400` with no body schema | Surveyed all eleven | Confirmed, one of eleven |
| `accountId` appears zero times in the specification | Parsed | Zero. The mismatch is with the scenarios, not internal |

### Departures from the design in 0c

- **`password` on `CreateUserRequest` only, though the design calls for both user request
  schemas.** On create it repairs a defect; on update it repairs nothing and publishes a
  design instead. The design was reasoning about ingress rejection, and its instruction
  generalised further than its argument did. The reasoning and the recorded omission are
  in `docs/spec-changes.md`.
- **The login endpoint is reclassified from "forced" to instructed**, which changes whose
  claim it is rather than what gets built. The design derives the endpoint from the
  specification's own silence. The accompanying requirements ask for it outright, and ask
  for the specification to be updated with its details — so it is an instruction carried
  out, not a defect found, and only the second would be a finding of mine.

  Worth noting *why* the design got this wrong, because the mechanism will recur: it
  reasons almost entirely from the specification, and this requirement lives in the other
  supplied document. Anything stated only in the requirements is in the design's blind
  spot by construction.

### Diff against the reference

**There is nothing to diff.** The reference branch carries no `openapi.yaml` at all — it
never edited the supplied document. What it has instead is
`probe/08-spec-conformance/`, which the consultation protocol marks read-freely, so it
was read directly rather than after an attempt.

| Difference | Verdict |
|---|---|
| The reference transcribes the supplied schemas into TypeScript *deliberately unfixed*, applying only forced item 3 so that Ajv can load them at all | **Neither better nor worse — a different purpose.** Its job was to demonstrate that the defects bite; this build's job is to ship a corrected document. Its file comment says so explicitly: "the point of this probe is to check our responses against the spec as written, not against a corrected spec." |
| The reference proves the balance ceiling **end to end** — two legal deposits through the real API, then validating the resulting `200` body against the supplied schema and asserting it fails on `keyword: 'maximum'` | **The reference is better, and this build cannot match it yet.** Verified here only at the schema level: with `maximum` removed, a `20000.00` balance validates. That establishes the fix, not the failure it fixes. Carried forward — the two-deposit test is worth reproducing once accounts and transactions exist. |
| The reference has no `additionalProperties` anywhere in its transcribed schemas | **Deliberate departure, and it is an addition to the supplied document rather than a disagreement with the reference.** Applied to response schemas only; the asymmetry and its cost are argued in `docs/spec-changes.md` and recorded as R30. |
| The reference refuses a £0 transaction with `exclusiveMinimum: 0` and a `400`, and its own test records that as a deviation | **Deliberate departure, per the design, which departs from the probe here.** Implemented as written: £0 is permitted. The probe's behaviour is defensible but returns a status the document does not sanction, and conformance is the assessed property. R8. |
| The reference's transcription omits `format: double` on the money fields | **Equivalent.** It is a registered format that constrains nothing; dropping it changes no validation outcome. |

### One thing to carry forward

The reference's conformance test is the strongest artefact in this area and it is
currently unreproducible here, because it needs a running service. It is not a test to
write from scratch at slice 8 — it is the natural closing test of slice 6, and the two
`F13` findings are only *demonstrated* rather than *asserted* until it exists.

---

## Slice 0d — the database layer

### Claim under test

> `F9` — a compose Postgres with no `volumes:` stanza silently inherits an *anonymous*
> volume across container recreation, and the failure presents as a broken migration
> rather than as a dirty volume.

**Confirmed, and the presenting symptom can be worse than the finding records.**

An honest note on the strength of this first, because it changes what the entry is
worth: the pass was declined earlier as a time decision, and what happened instead is
that the condition was still present in the working environment when this slice began.
So this is the probe's own run re-observed rather than an experiment designed here —
weaker than a designed pass, stronger than a citation. The second observation below is
new either way.

The environment held a running container from the earlier session:

| | |
|---|---|
| container `app-db-1` created | `2026-08-03T13:32:18Z` |
| its attached anonymous volume `4bccbab…` created | `2026-08-03T08:11:02Z` |

Five hours and twenty-one minutes apart, which is `F9`'s evidence reproduced exactly.
The container's own log still carried the consequence:

```
2026-08-03 13:33:34 UTC [547] ERROR:  relation "users" already exists
```

Three anonymous volumes were present in total, all three Postgres 17 data directories
(46.1MB, 71.1MB, 46.2MB) — so the mechanism had run at least three times.

**The new part, and it is a worse failure mode than the one recorded.** `F9` describes
the symptom as `relation "..." already exists`, which at least points at the schema. But
an inherited data directory carries its *roles* too, and the cluster in this one had been
initialised with a superuser that a later compose file did not ask for:

```
FATAL:  role "postgres" does not exist
```

That accuses the **connection string** — the one part of the setup a developer has
usually just checked and is most confident about. It is the same root cause presenting
one step further from it. Worth recording because the natural response is to start
editing credentials, and no amount of editing credentials fixes a stale volume.

**The fix, verified in both directions.** With `ledger-data` declared and named, the
daemon holds exactly one volume, `app_ledger-data`, instead of an unattributable hash.
Naming it does **not** make it ephemeral, and that distinction is the whole reason the
README troubleshooting line exists rather than being obvious:

| Command | Volume | Schema |
|---|---|---|
| `docker compose down` | survives | survives — `kysely_migration`, `kysely_migration_lock`, `migration_pipeline_proof` all still present after `up` |
| `docker compose down -v` | removed | rebuilt, and `initdb/` runs again, recreating `ledger` and `ledger_test` |

The cold start after `down -v` brings the suite up green from nothing, which is the only
path that exercises `initdb/` at all.

### Second claim under test, and this one came back negative

> Appending to `globalSetup` matters because "silently dropping it disables the toolchain
> test's reset".

**Half right, and the wrong half is the one that was warned about.** Both entries were
removed in turn and the suite run:

| Entry removed | Result |
|---|---|
| `test/db/global-setup.ts` | Fails, but *initially for the wrong reason* — see below |
| `test/toolchain/reset-serialisation-log.ts` | **Nothing fails. The whole suite passes.** |

The serialisation-log truncation is genuinely silent when removed, because `overlaps()`
is order-independent: records accumulated across runs stay well-nested, so appending more
well-nested records to a stale log changes no outcome. What that truncation actually
protects against is an *aborted* run leaving an unclosed `enter`, and nothing observes
its absence until one happens. The warning was right that the entry must not be dropped
and wrong about what would tell you.

**The database half was only loud by accident, and that got fixed rather than
documented.** With the reset skipped, the failure was
`expected [ …(2) ] to deeply equal [ Array(1) ]` — a row count, inside a test about typed
queries. Loud, but accusing the wrong component, which is the same pathology as `F9`
itself. It was also luck: the assertion happened to be an exact-equality on rows. So
`migration-pipeline.test.ts` now asserts the empty starting state explicitly, and the
same experiment fails on that assertion instead.

### Third claim, tested at its point of use

> `Migrator` and `FileMigrationProvider` are only on the `kysely/migration` subpath and
> are `undefined` on the root export.

**Confirmed at kysely 0.29.4**, in both directions: both are `undefined` on the root
export and functions on the subpath. Checked rather than trusted because every tutorial
and every model completion has the old path, and the failure is at runtime.

### A guard adopted from the reference and then deleted by measurement

The reference adds a check that `migrateToLatest` found *something*, on the reasoning
that a wrong `migrationFolder` "silently finds zero migrations and reports success". It
was adopted here, and then removed, because the premise does not hold. Every reachable
way of misdirecting the migrator is already loud:

| Situation | What actually happens |
|---|---|
| Folder does not exist | `ENOENT: no such file or directory, scandir '…'` — names the path |
| Folder exists but has lost already-applied migrations | Kysely's own `corrupted migrations: previously executed migration 001-migration-pipeline-proof is missing` — **better than a hand-written guard, because it names the missing migration** |
| Fresh database *and* empty folder | Silent — but `migration-pipeline.test.ts` asserts the ledger's contents, so this suite fails anyway |

So the guard covered nothing that was silent, and it required a parameter on a production
function to be testable at all. It is gone; the two failure modes are pinned as tests
instead, which is what makes the *absence* of the guard an argued position rather than an
oversight.

### Deliberate departures in 0d

- **Two databases, `ledger` and `ledger_test`, created by `initdb/`.** The §3 invariant
  requires the destructive helper to assert a `_test` suffix, and with a single database
  that assertion could only ever be tested against a name nobody uses. With `ledger`
  present, the guard stands in front of a live database and the test that proves it fires
  points the helper at exactly that string.
- **The reset helper takes a connection string and opens its own connection**, rather
  than accepting a handle. Accepting a handle lets the checked string and the connected
  database diverge, which is the failure the guard exists to prevent. Same structural
  argument as the repository port taking no balance (§7): make the dangerous thing
  inexpressible rather than discouraged.
- **The guard throws; it does not return a `Result`.** The codebase is errors-as-values,
  and this is the exception that proves the rule — a `Result` is a value a caller can
  hold and ignore, and the entire purpose here is that there is no way past.
- **All test-only code lives under `test/db/`**, including the guard. The reference keeps
  its reset in `src/db/reset.ts`, which puts `drop schema public cascade` in the
  production module graph.
- **No `migrate` script.** It needs a TypeScript runner, which forces the `tsx`-versus-
  native-Node decision still open from slice 0a. The migrator is driven from code and
  tests until the entrypoint exists at 0e. Worth recording that this slice supplies
  evidence for that decision: `FileMigrationProvider` loads `.ts` migration files under
  vitest with no `tsx` present.

### Diff against the reference, one line each

| Difference | Verdict |
|---|---|
| Reference `compose.yml` declares **no `volumes:` stanza at all** | **Reference was wrong, against its own finding.** This is the `F9` condition, not the fix. `FINDINGS.md` says to declare and name the volume; the code never did. Its own evidence sat in an anonymous volume for the life of the branch. |
| Reference has no second database; probes point at `ledger_probe` via `.env` | **Reference was wrong**, and doubly so. `ledger_probe` would fail this build's own `_test` guard, so the name is incompatible with the §3 invariant. And the isolation depended on `.env`, which is in `.gitignore` — absent that untracked file the probes fall back to `ledger`, the development database, and drop its schema. |
| Reference `resetSchema` has **no `_test` assertion**, and takes a `Kysely` handle | **Reference was wrong**, as §3 already anticipated. The handle signature is the deeper problem: even with a guard added, there would be nothing tying the name checked to the database connected. |
| Reference resolves the migrations folder with `import.meta.dirname` | **Reference was better, adopted.** The first attempt here used `fileURLToPath(new URL(…))`, which is the pre-Node-20.11 spelling and strictly more machinery for the same result. |
| Reference guards against a zero-migration run | **Reference was wrong, and this was adopted before being measured.** See the section above — every reachable case is already loud, and Kysely's own corruption check is better than the guard. |
| Reference renders a non-`Error` failure as `` `migration failed: ${JSON.stringify(error)}` `` | **Deliberate departure, and this build is safer.** `JSON.stringify` throws outright on a circular object, so the fallback for an unknown shape can itself fail. Attached as `cause` instead, which preserves the original whatever it is. |
| Reference has `truncateAll` for between-test isolation | **Outstanding, not a departure.** There is nothing to truncate yet. The reference's shape is the target, and the trade taken meanwhile is recorded as R31. |
| Reference exposes `connectionString()` reading `DATABASE_URL` with a default | **Equivalent in mechanism, extended here.** Same default-with-override shape; this build adds the parallel test-database accessor so the suite's target is chosen in code rather than by whatever happens to be exported in a shell. |
| Reference mounts an `initdb` script only in the probe compose, as a bind-mount test | **Equivalent, different purpose.** Its script existed to prove the DinD bind mount works; this one creates the test database. |
| Reference publishes the database as `"55432:5432"` | **Deliberate departure.** The short form binds `0.0.0.0`, putting a database with committed credentials on every interface. `127.0.0.1:55432:5432` here — nothing needs to reach it from off-box, and it is what makes R32's argument for committing those credentials actually true rather than merely stated. |
| Reference uses `function` declarations; this build uses arrow constants | **Equivalent.** Both spellings are already present in this repository. |
| Reference migration files take `Kysely<unknown>` | **Reference was right, adopted without change.** A migration must keep compiling after the schema type has moved past it. |
| Reference's `down` uses `.ifExists()` on every drop | **Deliberate departure.** With one table and a schema that is dropped wholesale before every run, `ifExists` would hide a `down` that failed to do its job. |

### One thing to carry forward

The suite resets **once per run**, not between test files or between tests. That is
sufficient while one file touches the database and will not be when step 2 adds a second.
The reference's `truncateAll` is the right shape to adopt at that point — including its
note that `cascade` is required because of the foreign-key chain, and `restart identity`
so ids do not drift between tests. Recorded as R31 so it is a decision with a date rather
than something discovered when two files start interfering.

---

## Slice 0e — the skeleton

### Claim under test

> Node runs this project's TypeScript entrypoint directly, so `tsx` is a dependency this
> build does not need.

**The falsification pass came back negative. The conclusion survived, by a different
route than the claim proposed.**

`node src/main.ts` fails with `ERR_MODULE_NOT_FOUND: /app/src/http/app.js`. Native
type-stripping executes TypeScript but does not rewrite module specifiers, and `nodenext`
with `verbatimModuleSyntax` requires the `.js` extension the *emitted* file would carry.
Under `noEmit: true` nothing is emitted, so that specifier names a file which does not
exist. `node --help` offers `--experimental-strip-types` and
`--experimental-transform-types`, and nothing that rewrites specifiers.

**The evidence that made this look already answered was two half-truths, and both are
worth naming because each looked sufficient.** Node 24 does run a `.ts` file with no
flag — but only one with no relative imports, which describes no file in this project.
And slice 0d's observation that `FileMigrationProvider` loads `.ts` migrations with no
`tsx` present is an observation about **vitest**, which resolves modules itself. Neither
measurement touched `node` executing a multi-file program.

### What was measured, rather than argued, before choosing

Three ways out. Each was run to a `200` from the endpoint before being compared.

- **`tsx`.** Works. Also **re-arms the `F1` build-script gate**, because it installs
  esbuild, which declares a `postinstall` — slice 0a's hazard, armed for real, and caught
  only by 0a's instruction to re-check `allowBuilds` whenever a dependency is added. What
  it costs and the one detail worse than 0a predicted are in **R18**, which owns that
  risk.
- **A build step.** `tsc -p tsconfig.build.json` then `node dist/main.js`. Works. No
  dependency, and the gate stays unarmed.
- **`.ts` import specifiers.** Would work natively with neither dependency nor build, at
  the cost of changing every relative import in the repository and adding
  `allowImportingTsExtensions`. Not measured beyond that, because the cost is the
  argument against it.

**Chosen: the build step.** `tsx` was declined not on taste but on the measured cost —
re-arming a gate whose presenting symptom is "the toolchain is completely broken", in a
repository whose README tells a reviewer to run `pnpm install --frozen-lockfile`, in
exchange for watch mode. The build path also refuses to start code that does not
typecheck, and it is the shape a deployed service uses anyway.

`tsconfig.build.json` carries emit settings only and `extends` the base config, so what
`pnpm build` compiles is compiled under the settings `pnpm typecheck` checks. `rootDir`
is set explicitly because TypeScript 6 raises `TS5011` without it rather than inferring
the common source directory as 5.x did.

### Second claim under test, predicted from the tsconfig before the attempt

> Express 5's types need an interop dance, the same shape as the `ajv-formats` problem.

**Falsified.** `import express, { type Express } from 'express'` typechecks unchanged.
`@types/express` does declare `export = e`, but the two cases are not the same shape:
`ajv-formats` declares an ESM `export default`, which under `nodenext` makes TypeScript
type the default import as the module namespace, whereas `export =` is exactly the form
`nodenext`'s CommonJS interop resolves correctly. The `ajv-formats` comment's advice —
look for a named export before reaching for a cast — was followed and turned out not to
be needed either. No cast anywhere.

### Third claim under test, carried forward from slice 0a

> `supertest` brings six `no-unsafe-*` lint errors, so the exemption must be scoped to
> test files.

**Falsified, and the exemption is not needed at all.** `pnpm lint` is clean with the
supertest test in place. `@types/superagent` does type `body` as `any`, so the premise is
true; what is false is that using supertest is enough to trigger the rules. Asserting on
the whole body — `expect(response.body).toEqual({ status: 'ok' })` — leaves the `any` in
a generic parameter position and nothing fires.

**Verified live rather than assumed absent**, because a rule that reports nothing is
indistinguishable from a rule that is switched off: adding `expect(response.body.status)`
produces `Unsafe member access .status on an 'any' value`. So the rules are working, and
the trigger is the *assertion style*, not the dependency. Whole-body `toEqual` assertions
are better assertions anyway — they catch an extra field, which is the property egress
validation exists to guarantee at step 2 — so this is a case where the strict rule and
the better test agree, and no exemption has to be written.

### The composition root, which A4 assigns to this step

`src/http/app.ts` exports `createApp()`, which registers every route **one line each**
against a named handler, and returns the app without listening. `src/main.ts` is the only
thing that listens.

Two consequences, and the second is the reason for the split rather than a side effect.
Adding a route is one line next to nine like it, with nothing between that line and the
function it names — no registry, no decorator, no filesystem scan. And a test drives the
real HTTP stack without a port, which is what `src/http/health.test.ts` does.

### Deliberate departures in 0e

- **The health endpoint is not published in `openapi.yaml`.** Recorded, with its
  reasoning, in `docs/spec-changes.md` § Additions.
- **The route body lives in its own module** rather than inline in the composition root.
  The reference does the opposite; see the diff below.
- **No `dev` script.** The build step has no watch mode, and `tsc --watch` alongside
  `node --watch` is two processes to document for a convenience nothing in the workflow
  needs yet. `pnpm test` is the loop this repository actually runs.
- **No `migrate` script still.** 0d deferred it to this step as a consequence of the
  `tsx` question; with a build step available it would now be `pnpm build` followed by a
  script pointing into `dist`, which is more machinery than the migrator's two current
  callers need. Deferred again, deliberately, and it is one line whenever a caller wants
  it from a shell.

### Diff against the reference, one line each

| Difference | Verdict |
|---|---|
| Reference ships a `tsx` dependency and `dev: "tsx watch src/main.ts"`, but its tree contains **no `src/main.ts`** | **Reference was wrong, and this settles the question 0a deferred.** That script cannot ever have run. The dependency is therefore undefended by the reference's own tree — it was carried because examples carry it, which is precisely the useless outcome this pass exists to avoid. |
| Reference has no `build` or `start` script, and its README documents no way to run the service | **Reference was wrong.** It is a service that could not be started, only tested. |
| Reference's composition root is `buildApp(db)` inside `src/http/routes.ts` | **Equivalent in role, deliberate departure in shape.** Worth recording that a composition root *does* exist there — the expectation carried into this slice was that there would be nothing to diff against. What it lacks is the entrypoint that calls it. |
| Reference registers each route with its handler body inline, roughly ten lines apiece | **Deliberate departure.** A4 asks for one line per route because the shape gets copied at speed by someone who did not write it, and a ten-line body is a template to edit rather than a line to add. The bodies are legible; that is not the objection. |
| Reference has `/health` inline in `buildApp`, returning `{ status: 'ok' }`, unversioned | **Equivalent, and arrived at independently.** Same path, same body, same decision to keep it outside `/v1`. |
| Reference imports `express, { type Express, type Request }` with no cast | **Reference was right**, and so was the code written here before it was consulted. See the second claim above. |
| Reference disables six `no-unsafe-*` rules across its probe tree | **Reference was wrong, or at least over-broad.** One rule fires, only on drilling into `res.body`, and the assertion style that avoids it is the better assertion. Nothing is disabled here. |
| Reference passes `db` into the composition root; `createApp()` takes nothing | **Outstanding, not a departure.** Nothing in this slice touches the database. The parameter arrives with the first endpoint that needs it, at step 2. |
| Reference registers `correlationMiddleware` and `express.json({ limit: '16kb' })` before any route | **Outstanding, correctly.** Both are step 1 — observability is §8b and the body parser has nothing to parse until a route reads a body. |

### One thing found, and fixed rather than carried forward

`tsc` overwrites what it emits and does not remove what it no longer emits, so renaming a
module leaves its stale `.js` in `dist/`. First recorded here as latent; then fixed,
because the alternative was a README instruction that only works if it is remembered, and
`pnpm build` clearing its own output directory is a mechanism instead. Verified with a
planted `dist/stale-module.js`, which the next build removed.

**It clears the directory with `node -e` rather than `rm -rf`, and that is the part worth
recording**, because the obvious spelling would quietly break a claim made elsewhere. The
README tells a reviewer that this path needs nothing but Node and pnpm; `rm -rf` makes
that false on Windows. Note that `runcontainer.ps1` does not settle it — it only ever runs
`devcontainer up`, so scripts written here always execute in bash, and it is the
reviewer's shell rather than the author's that the portable spelling is for.

---

## Slice 1 — the error envelope

### Claim under test

> An Express error handler is recognised purely by having four parameters, so deleting
> the unused one silently turns it into ordinary middleware — it still compiles, still
> lints, and the run goes green.

**Falsified, in its last clause, and that is the clause the whole claim rested on.**
Measured by deleting `_next` from `errorMiddleware` and running everything:

| Check | What it said |
|---|---|
| `pnpm typecheck` | nothing. A three-parameter function is assignable to `ErrorRequestHandler`, so the annotation does not carry arity |
| `pnpm lint` | nothing |
| `pnpm test` | **seven failures**, one of them printing the HTML page with a stack trace and absolute filesystem paths |

So the tooling is silent exactly as predicted, and the suite is not. `docs/conventions.md`
had reserved a comment beside the handler for this consequence; the measurement says it is
not owed, and it was not written. The tests that cover the error path stand in its place,
which is the better outcome — an assertion cannot go stale the way a sentence can. The
reservation in `conventions.md` has been amended to record the result, including what it
leaves open about the `argsIgnorePattern` comment itself.

### Second claim under test

> §8a's adapter makes "every `Result` is handled" a compile-time property at the boundary.

**Negative — it holds — and it is now pinned rather than measured.** A one-off measurement
would have proved it for one afternoon, so it went into `handler.type-assertions.ts`
instead, where each `@ts-expect-error` fails the build if the error it names stops being
produced. Four failures are pinned: a handler returning a bare body rather than a
`Result`, one widening its error channel past the closed union, one dropping the status,
and one using a status this API does not publish.

**And attempting it produced a correction to §8a's signature.** The literal
`Promise<Result<Success<T>, DomainError>>` does not accept `ResultAsync`, which is
thenable but has no `catch` or `finally` — so the parameter as designed rejects the one
shape a service layer naturally returns and forces every handler into an `async` wrapper.
`PromiseLike` accepts both, and both spellings are pinned so that narrowing it back cannot
pass unnoticed.

### A third measurement, taken because of what step 1 is for

Adding an error kind should be a small, obvious change, so the shape of the *failure* that
guides it matters. Both candidate shapes were built and a fourth member added to the union:

| Shape | Errors reported | What the message said |
|---|---|---|
| `Record<DomainError['kind'], …>` | 2 | `Property 'Conflict' is missing in type … but required in type Record<…>` |
| `switch` with a `never` default | 2 | `Type '… & Conflict' is not assignable to type 'never'` |

**The count is a tie and the message is not.** A `never` default reports an assignment
failure and leaves the reader to work out which member caused it; the table names the
missing kind. The design's `never` default was adopted in spirit and dropped in spelling.

Two errors rather than one is also the right number, arrived at by correcting a defect
rather than by design. There are two tables — `LEVELS` beside the constructors and
`STATUSES` in the renderer — because adding a kind genuinely requires two decisions, and
the compiler now asks for each in the file that owns it. The first attempt put both in one
table and reported once, which read better and was wrong: it left the log level being
passed to the constructor by hand as a separate argument, so "level follows kind" was an
intention rather than a fact, and a second copy of the mapping sat in the renderer free to
disagree with it. Found in review, and the fix deletes a parameter.

### Deliberate departures in 1

Two of these narrow what the design put in this step. Both follow one rule, which is
stated here in the terms the repository can carry: **machinery arrives with the step that
consumes it.**

- **`authedHandler` is not built.** Its parameter types are decided entirely by the
  authenticator — whether verification is async, what its failure kind is, what the JWT
  payload validation returns — and none of that exists yet. Building it now means
  inventing a placeholder for each and having the real thing bend to fit. A2's amendment
  says exactly this about extracting an abstraction from a single case; this would be
  extracting from none. The structural guarantee it is supposed to provide comes from the
  handler never receiving `res` and receiving its identity as a parameter, and both are
  established by `publicHandler`, which the authed variant will wrap rather than replace.
- **Four of the seven error kinds are not built.** `ValidationFailed`, `NotFound` and
  `Unexpected` are load-bearing at this step — malformed JSON needs a 400 carrying
  `details`, the 404 fallback needs an envelope, and an unhandled throw needs somewhere to
  land that is not Express's HTML page. Nothing raises a 401, 403, 409 or 422 yet. What
  makes deferring safe here is a mechanism rather than a promise: the measurement above
  shows that adding a member is a single located compile error. Three members are also
  enough to exercise everything the observability design guarantees — the payload ban on
  the client-facing constructors with `unexpected` as the permitted exception, and level
  following kind across both the 4xx and 5xx sides.
- **`toPennies` returns `Result<Pennies, DomainError>`, not `Result<Pennies, InvalidAmount>`.**
  A narrower channel would have to name the intersected member type, which means writing
  the correlation-id intersection a second time — and §8b's reason for intersecting onto
  the union in one place is that a member added later cannot then forget it. The union is
  the error channel.
- **`toDecimal` is not built.** Nothing renders money yet.
- **A body over the limit renders as 400, not 413.** Setting `limit: '16kb'` creates a
  failure mode none of §8's six criteria names: body-parser raises `entity.too.large`,
  which would otherwise fall through to `unexpected` and answer 500 to what is plainly a
  client error. The specification publishes no 413, so it renders as a validation failure
  with a `details` entry naming the limit.
- **The logger is hand-rolled, writes to stdout, and knows nothing about tests.** One JSON
  object per line, which is what a collector expects and what `JSON.stringify` already
  escapes correctly. Silencing it during the suite is done by a test helper that spies on
  the sink, so no branch on `NODE_ENV` and no swappable-sink API exists in production code
  for the benefit of tests. See the reference diff.

### One thing found rather than predicted

**body-parser's `SyntaxError` message embeds a fragment of the body it failed to parse.**
The harmless reading is `Unexpected token } in JSON at position 5`; the reading that
matters is a failed signup whose fragment is a password. Translating that error by
carrying its message across would have walked a credential into the log by a route §8b
never names, because §8b is about the *payload* parameter and this arrives as an
exception's `message`. The parser's message is discarded and a fixed one substituted.
Asserted rather than described: `error-envelope.test.ts` posts a malformed body carrying a
password and greps every log record for it.

### Diff against the reference, one line each

| Difference | Verdict |
|---|---|
| Reference echoes the correlation id as an `x-correlation-id` response header, on every response | **Reference was right, and it is adopted.** The envelope's copy covers only requests that failed; the header covers the ones that succeeded slowly, which is the other half of the question a support request asks. |
| Reference's renderer `throw`s in its `never` default branch | **Reference was wrong.** That branch is unreachable by construction, but it is reached from the error middleware — the one place in the stack with nothing above it to catch — so the safe fallback is to render a 500, not to throw. |
| Reference's logger branches on `NODE_ENV === 'test'` and exports `setLogSink`, `resetLogSink` and `captureLogs` | **Deliberate departure.** That is a test-only API and a test-only branch living in production code. The capture helper here is in `test/`, and production code has no idea the suite exists. |
| Reference's logger writes to stderr | **Deliberate departure.** Records at `info` for ordinary client mistakes are not diagnostics of a failing process; stdout is where a collector expects them. |
| Reference's `toPennies` returns `number \| null` | **Reference was wrong, by its own brief** — §4 specifies a `Result`. A `null` return also puts the failure outside the error channel, so the caller has to invent a message and cannot log at construction. |
| Reference has no branded `Pennies` type | **Deliberate departure.** A bare `number` lets an amount in pounds be passed where pennies are expected, which is an arithmetic error a hundred times too small and entirely silent. |
| Reference assembles every client-facing message inside the renderer, from a `resource` field | **Equivalent.** Both put a call-site-controlled string into the envelope, so the exposure is identical; the difference is only where the sentence is composed. |
| Reference's `Success<T>` has `status: number`, with `created`/`okBody`/`noContent` helpers | **Deliberate departure.** `200 \| 201` makes a status this API does not publish a type error, which is pinned. `noContent` belongs to the `DELETE` endpoints, which section 9 defers. |
| Reference's `Unexpected` carries `fellThrough: true` | **Deliberate departure.** A marker field with no consumer. Its stated purpose — "this was not classified" — is already true of every `Unexpected`, since it is the catch-all. |
| Reference's adapter takes a response schema and runs egress validation inside | **Outstanding, correctly.** §8c puts egress validation with the first response schema, at step 2. It confirms the adapter gains a parameter there rather than changing shape. |
| Reference exports `withCorrelationId` "for tests and for jobs" | **Deliberate departure.** Neither exists. |
| Reference's malformed-JSON branch, `res.headersSent` guard and path-less 404 fallback | **Equivalent, and arrived at independently.** |

### Corrections to catalogue entries written in advance

Three entries were written from the design before the code existed, and building it made
two of them wrong in detail. Corrected in place, in the catalogue, which owns them.

**R11** no longer claims the two 2dp mechanisms can drift, because they now share one
predicate. **R25** was wrong about the route — attacker-controlled log content does not
wait for the JWT path, it is live today via the field names Ajv reports for an unknown
property. And **R24** was rewritten rather than adjusted: raised in review, the question
was whether `payload?: never` is anything more than a convention, and measuring it says
it guards one key name — `{ body }`, `{ requestBody }` and `{ ...body }` all compile. The
entry now carries that table, the three accepting cases are pinned in
`errors.type-assertions.ts` so the boundary is recorded rather than rediscovered, and the
allowlist that closes it is repriced: the design called it "a larger piece of work" and it
is a net deletion.

That correction also reaches section 3, which lists "no credential and no request-body
value ever reaches a log record" as mechanised. It holds — but what makes it hold is that
the constructors compose their log fields from Ajv metadata, names without values, rather
than the type that appears to promise it. The type mechanises the regression, not the
invariant. R24 owns the distinction.

### One thing to carry forward

The adapter is the thing steps 2 through 6 repeat, and it now has two known changes ahead
of it rather than none: a response-schema parameter at step 2, and the authenticated
variant at step 3. Both are additions to `src/http/handler.ts` and neither changes what a
handler returns, which is the part that gets copied.

---

## Slice 2 — `POST /v1/users`

### Claim under test

> `additionalProperties: false` on the response schemas turns section 3's "no persistence
> entity and no password hash ever reaches a response body" from a checklist item into a
> checked property: a leaked `password_hash` becomes a 500 rather than a disclosure.

**Negative — it holds — and it was verified by removing the mechanism rather than by
watching it pass.** A service returning a row with `password_hash` on it is pinned in
`users.test.ts`; the leak needs a cast, because the service's return type already makes it
unrepresentable, and a leak that gets past the type is the only kind there can be.

| Response schema | What the client got |
|---|---|
| with `additionalProperties: false` | **500**, envelope only, hash absent from the body and from every log record |
| with it removed from the root object | **201, with the hash in the response body** |

The second row is the measurement. A test asserting only the first would have passed with
the mechanism switched off.

### Second claim under test

> Validating the in-memory object checks something the client will never receive. Ajv's
> type checks are `typeof`-based, so a `Date` satisfies `type: 'object'` but fails
> `type: 'string', format: 'date-time'`. This will fire immediately and correctly.

**Negative — it holds, and it fired on the first request through the endpoint**, before
the fix was written:

```
mismatches: ["createdTimestamp must be string", "updatedTimestamp must be string"]
```

Kysely returns `Date` for `timestamptz` and the specification publishes `date-time`
strings. The serialise-first fix was then adopted as a response to that failure. Note what
the fix does rather than merely prevents: `JSON.stringify` renders a `Date` as an ISO-8601
string, which *satisfies* `format: 'date-time'` — so validating the serialised form both
accepts a legal response the in-memory check rejected and checks the bytes the client
actually receives. The in-memory check was wrong in both directions at once.

### A third measurement, taken because the design's spelling looked wrong

`ColumnType<Date, never, never>` reads as though it should make a column impossible to
insert: `never` is uninhabited, and Kysely's insert-optionality test is whether `undefined`
extends the insert type, which it does not. On that reasoning the table could not be
written to at all, and the spelling was changed to `ColumnType<Date, undefined, never>`
before anything was run.

**Wrong, and the design was right.** Measured with both spellings side by side: under
`never` a row omitting the timestamps compiles, supplying one is an error, and updating one
is an error — identical to the `undefined` spelling in all three positions. The design's
spelling was restored. It is now pinned in `src/db/schema.type-assertions.ts` rather than
recorded here as a fact about an afternoon, and the update case is verified in both
directions: with the `@ts-expect-error` removed, `pnpm typecheck` fails naming the line.

The reference implementation uses `ColumnType<Date, never, never>` as well.

### The claim `errors.ts` was holding, and it did not survive its first call site

The payload exemption on `unexpected` was justified in a comment: the body it carries is
the service's own output, so when a response fails its published schema that body is the
entire diagnostic. **The first call site to exercise it is egress validation, and the
response that fails its published schema is — in the case the mechanism exists for — one
carrying a leaked `password_hash`.** Logging the body moves the secret from the wire to
the log store, which is not a fix.

`responseValidatorFor` therefore logs Ajv's mismatches, which name the offending property
and never its value, and the comment has been corrected in place. The permission stands;
the justification does not. R24 still owns the general question.

**The reference implementation does log it** — `payload: serialised` — so its egress check
writes a leaked hash into the log store on exactly the request the check exists to catch.

### R31, closed and verified in both directions

The per-test truncate was written before the endpoint, as the entry advised. With the
`beforeEach` removed, two tests fail because the first test's user survives into the second
and the signup answers 409 where a 201 was expected. `restart identity` was prescribed by
the entry and deliberately not built: no table in this design has an identity column. The
entry records both.

### Deliberate departures in 2

- **The proof migration and its table are deleted**, which is what both the migration file
  and `src/db/schema.ts` said should happen when the first real table arrived. Two of the
  five tests in `migration-pipeline.test.ts` went with them; `users` proves the typed
  builder for real. The three migrator failure-mode tests remain, retargeted.
- **Email uniqueness is a unique index on `lower(email)`, and the address is stored as
  submitted.** Two rows differing only in case are two accounts for one human. The
  alternative — normalising to lower case on write, which is what the reference does —
  closes the same hazard but returns an address the caller did not type. The cost of this
  choice is a forward obligation: every lookup by email must use `lower(email)`, starting
  with login at step 3.
- **A repository port, which the reference does not have.** Its user persistence is inline
  in the service, so the service knows column names and SQLSTATEs. Here `UserRecord`
  carries no `passwordHash` at all, which makes the disclosure this slice tests for
  unrepresentable one layer below where egress validation catches it.
- **`BCRYPT_COST` is configuration**, 12 by default and 4 under vitest. The reference
  hardcodes 10, departing from its own brief. A cost that fails to parse throws rather
  than falling back, because a silent fallback under test means a slow suite with no
  visible cause — asserted in `password.test.ts`, including that the suite is running at 4
  and not at the default.
- **`maxLength: 72` on `password`**, which the reference also has and which is published
  here rather than only enforced. The measurement, and the half of it that `maxLength`
  cannot close, are in R36.
- **The adapter's response schema is not coupled to the handler's body type.** Attempting
  it produces TS2589. R35 prices the assertion that would recover most of it.

### Diff against the reference, one line each

| Difference | Verdict |
|---|---|
| Reference's `egressCheck` logs `payload: serialised` | **Reference was wrong, and it is the sharpest finding of the slice.** The body that fails egress validation is the one carrying the leak; logging it relocates the disclosure rather than preventing it. |
| Reference performs the JSON round trip inside `egressCheck` rather than at the call site | **Reference was right, and it is adopted.** Serialising in the adapter leaves a validator that quietly checks the wrong thing if anything else ever calls it. It now returns the serialised body it checked, so what is validated is what is sent. |
| Reference matches `23505` alone, without checking which constraint was violated | **Reference was wrong**, by section 4's own rule for the account-number retry. It is harmless while `users` has one unique index and becomes a mislabelled 409 the moment it has two. |
| Reference normalises `email` to lower case on write | **Deliberate departure**, above. |
| Reference has no repository port for users | **Deliberate departure**, above. |
| Reference hashes at a hardcoded cost of 10 | **Reference was wrong, by its own brief** — section 4 specifies configuration, 12 default and 4 in tests. |
| Reference's `login` compares against a dummy hash so unknown-email and wrong-password take similar time | **Reference was right.** Not this slice's to build; it belongs with step 3 and is noted here so it is not rediscovered. |
| Reference's `toResponse` formats timestamps with `.toISOString()` in the service | **Equivalent**, and now redundant here: the adapter validates and sends the serialised form, which renders `Date` identically. |
| Reference spreads `line2`/`line3` conditionally because of `exactOptionalPropertyTypes` | **Not applicable.** Section 4 declines that flag, so `?? undefined` suffices and `JSON.stringify` drops the key. |
| Reference's `Success<T>` has `status: number` with `created`/`okBody`/`noContent` helpers | **Already recorded at slice 1**, unchanged by this slice. |
| Reference builds the trigger function with `create or replace` and loops over its tables | **Equivalent.** One table arrives per migration here, so there is nothing to loop over. |
| Reference's `handler` hands the promise to Express and `.catch(next)`s it | **Equivalent, and the reference's guard is unnecessary on Express 5.** Predicted here that awaiting inside an `async` handler would turn a throwing service into an unhandled rejection; measured, and it does not — Express 5 propagates the rejection to the error middleware and the envelope comes out intact. Pinned in `error-envelope.test.ts` rather than left as a claim. |

### One thing found by writing this document down

The row above about `.catch(next)` was written as a *departure to act on* — the claim being
that awaiting inside an `async` handler turns a throwing service into an unhandled
rejection. It was measured only because it had been written into a deliverable as fact, and
it is false: Express 5 propagates the rejection and the 500 envelope is intact. Section 4
already says this ("native async error propagation — including from `async` middleware")
and the prediction contradicted it without noticing.

Two things follow. The reference's `.catch(next)` is Express 4 defensiveness rather than a
gap here. And the property is now a test, because it is a property of the framework that
the adapter silently depends on: an Express downgrade, or a future adapter that catches
and re-throws, would break it with nothing else complaining.

### One thing to carry forward

`authedHandler` at step 3 is an addition to `src/http/handler.ts` beside a parameter this
slice just added. The registration shape a route copies is now
`publicHandler(responseSchema, fn)`, and the authenticated variant should wrap rather than
replace it, so that the egress check cannot be bypassed by choosing the other adapter.
