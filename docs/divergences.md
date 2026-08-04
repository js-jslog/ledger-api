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
| Reference has `dev: "tsx watch src/main.ts"` and a `tsx` dependency | **Outstanding, deferred to 0e.** Node 24 runs TypeScript natively, so `tsx` may be a dependency this build does not need — and every direct dependency has to be defensible in the README table. Decide when the entrypoint exists. |

### One thing to carry forward

The reference disables six `no-unsafe-*` rules for its probe tree, because `supertest`
types `res.body` as `any` and asserting on a response body is therefore "unsafe" by
those rules. Not needed yet — `supertest` arrives with the first endpoint. Noted so it
is a known cost at slice 1 rather than a surprise, and so the exemption stays scoped to
test files instead of being loosened globally.
