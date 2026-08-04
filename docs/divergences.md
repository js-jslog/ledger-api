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
