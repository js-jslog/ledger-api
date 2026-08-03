# ledger-api — probe of build brief revision 3

**This is not the implementation.** It is an adversarial probe of the build brief,
run before the real 12-hour build, to find the problems that would otherwise be
found at 11pm on evening two. The code is real and works, but it exists to make
claims falsifiable, not to be submitted.

The output is [`FINDINGS.md`](./FINDINGS.md) — fifteen findings, each stating what
the brief claims, what actually happens, and what the brief should say instead.

## What to read, in what order

1. **[`FINDINGS.md`](./FINDINGS.md)** — the deliverable. Severity table at the top.
2. **`src/`** — a working vertical slice of everything §9 puts in scope, built to
   the brief's own design decisions so those decisions could be tested rather
   than discussed.
3. **`probe/`** — one directory per probe, each a test file that establishes a
   claim. These are the evidence for the findings.

## Headline results

| | |
|---|---|
| Confirmed as the brief states | All five §8 Express 5 criteria; every §7 concurrency figure; every §4 money claim; the `kysely/migration` subpath; nested `additionalProperties`; §6 P7 |
| §14 unknowns resolved **favourably** | Async middleware error propagation; the four-library seam at runtime; suite time (**~6s**, 101 tests, full DB integration) |
| §14 unknowns resolved **unfavourably** | The devcontainer/compose risk is described backwards (F3); the four-library seam does not *typecheck* in its natural shape (F7) |
| Step-0 blockers the brief does not mention | pnpm 11's build-script gate (F1); TypeScript 7 vs typescript-eslint (F2) |
| Claims that are wrong | §7's justification for the 422 (F10) |
| Forced build items with no decision recorded | 2dp money validation (F6); account-number minting (F11); timestamp maintenance (F12) |

The findings most worth acting on before the real build starts are **F10** (§7's
"a zero-row update can only mean insufficient funds" is false, and §7 is the
section ADR 2 is built on) and **F1/F2** (both consume the 90-minute stop line for
reasons that have nothing to do with the database, so §11's fallback would not
rescue either).

## Running it

Requires Docker and pnpm. From the repository root:

```bash
pnpm install                 # read pnpm-workspace.yaml before changing it
docker compose up -d --wait  # Postgres on localhost:55432, healthy in ~3s
docker compose exec -T db psql -U ledger -d ledger -c 'CREATE DATABASE ledger_probe'
pnpm vitest run              # 101 tests, ~6s
pnpm typecheck && pnpm lint  # both clean
```

Probes 04 onward need the database. They use a dedicated `ledger_probe` database
and rebuild its schema on every run rather than trusting what they are handed —
see F9 for why that is not paranoia.

If anything database-shaped misbehaves inexplicably, `docker compose down -v`.
Without `-v` the data survives, including across container recreation (F9).

## Scope, and what this probe did not do

Built the §9 in-scope endpoints only: `POST /v1/users`,
`GET /v1/users/{userId}`, `POST /v1/auth/login`, `POST`/`GET /v1/accounts`,
`GET /v1/accounts/{accountNumber}`, and the three transaction endpoints. No
`PATCH`, no `DELETE` — §9 defers them, and F10 notes that deferring
`DELETE /v1/accounts/{accountNumber}` is precisely what hides the 422 bug.

`isJsonValidRz` was not available to this session, so `src/http/validate.ts` is a
stand-in built to the same description (Ajv + `json-schema-to-ts` behind a
`Result`). F7's typechecking problem is a property of that combination rather than
of any particular implementation of it, so it will recur.

Deliberately not probed: whether ~12 hours is enough, the §9 drop ordering, and
anything about the interview itself. Those are judgement calls, not claims.
