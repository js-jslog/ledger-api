# ledger-api — probe repo

Not a candidate implementation. This is an experimental slice built to stress-test a
solution brief for the Eagle Bank take-home before the real, human-supervised build
starts. Findings are in **[NOTES.md](./NOTES.md)**.

## Run it

```sh
docker compose up -d
pnpm install
docker compose exec -T db psql -U ledger -d ledger -q < src/db/schema.sql
pnpm typecheck && pnpm test
```

## Layout

| Path | What it is |
|---|---|
| `probes/pNN-*.test.ts` | One experiment per file, each attacking one claim |
| `src/db/` | Kysely types, `schema.sql`, connection + int8 type parser |
| `src/domain/` | Error taxonomy, money, ids, password, tokens, service |
| `src/http/` | Express 5 app and the single domain-error → status mapping |
| `src/validation/` | `isJsonValidRz` stand-in and schemas, with deviations marked |

Implemented: create/fetch user, login, create/fetch account, create/list transaction.
`PATCH`/`DELETE` answer 501 deliberately. Every deliberate divergence from the supplied
OpenAPI spec is marked `SPEC DEVIATION` in `src/validation/schemas.ts`.
