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
