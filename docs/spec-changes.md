# Specification changes

Every edit made to the supplied `openapi.yaml`, with the reason. The document is an
input to this build rather than only a deliverable, so the edits were made at the start
rather than reconciled at the end — the ingress schemas derive from it, and the ingress
schemas are upstream of everything.

Changes fall into four kinds, and the distinction is the point of the document:

| Kind | Meaning |
|---|---|
| **Forced** | The build cannot proceed without it. |
| **Corrective** | A defect in the document, not a design choice of its author. |
| **Unsatisfiable** | The specification contradicts itself, so *every* available behaviour breaks something. |
| **Addition** | Not wrong as published; this service publishes more than it was given. |

Observations that did **not** become edits are at the end. They are the larger half of
what reading the document carefully produced.

**Two supplied documents, and they are not the same kind of thing.** The
`openapi.yaml` is the *specification*; the accompanying scenarios and prose are the
*requirements*. Where they disagree, the requirements win, because they are what the
specification is meant to serve — and one change below is instructed by the requirements
outright rather than reasoned out from the specification. That distinction is marked at
each item, because "the requirements told me to" and "I read the document carefully and
found this" are different claims and only the second is mine to make.

The `info` block is untouched, including its title and description. It is supplied
content and it is committed verbatim.

---

## Forced

### 1. `password` on `CreateUserRequest` and `UpdateUserRequest`

The accompanying requirements ask for authentication by credential, and for error
handling that covers "invalid or missing credentials". The specification defines no
password field anywhere — so there is no credential to supply, and nothing for that
error handling to be about.

Added `password` to `CreateUserRequest`: required, `minLength: 12`, and
`writeOnly: true`.

`writeOnly` is doing real work rather than decorating. It is the OpenAPI declaration
that a field appears in requests and never in responses, which is exactly the invariant
this service holds about credentials — so the guarantee is stated in the published
document in a form a tool can read, not only in prose.

This edit is what makes ingress validation possible at all. This service rejects unknown
properties on request bodies, so without the field a signup carrying a password would be
rejected by the very mechanism that is supposed to protect it.

**`UpdateUserRequest` deliberately does not get one, and the omission is the decision.**
Adding it there would not fix a defect; it would publish a design — a `PATCH` accepting a
new password with nothing but a bearer token, no current-password check, and no
invalidation of tokens already issued. That is the shape account takeover takes after a
session is compromised, and publishing it is worse than publishing nothing, because a
specification is what an implementer implements.

Changing a password correctly needs the current password, a decision about what happens
to live tokens, and most likely an endpoint of its own rather than a field on a general
update. That is a design conversation, and this document is not the place to have it
silently. Recorded here so the gap is visibly chosen rather than overlooked.

### 2. `POST /v1/auth/login`

Added, along with an `auth` tag, a `LoginRequest` and a `LoginResponse`.

**This is the one change the requirements instruct directly rather than leave to
inference,** and it is worth separating from the rest of this document on those grounds.
They ask for one or more endpoints that authenticate a user and return a JWT to be
passed as a bearer token to every endpoint except user creation, and they ask for the
specification to be updated with that endpoint's details as part of the submission. So
this is not a defect found by reading the specification — the specification's silence is
the gap the instruction exists to fill, and adding it here is the instruction being
carried out.

It is the only operation besides user creation with no `security` block, necessarily so:
it is where a credential is exchanged for a token.

**`LoginRequest.password` deliberately carries no `minLength`,** though the signup field
does. Enforcing the signup policy at login would turn a short password into a `400`
naming the minimum length, where it should be an indistinguishable `401`. A validation
message is an oracle for the password policy, and the login endpoint is the one place
that costs something.

### 3. Six `format:` keywords holding regular expressions

`format` in JSON Schema names a *registered* format — `email`, `date-time`, `uuid`. It
does not take a regex; `pattern` does. The document puts a regex in `format` six times,
all within `components.schemas`:

| Schema | Property | Value |
|---|---|---|
| `BankAccountResponse` | `accountNumber` | `^01\d{6}$` |
| `TransactionResponse` | `userId` | `^usr-[A-Za-z0-9]+$` |
| `UserResponse` | `id` | `^usr-[A-Za-z0-9]+$` |
| `CreateUserRequest` | `phoneNumber` | `^\+[1-9]\d{1,14}$` |
| `UpdateUserRequest` | `phoneNumber` | `^\+[1-9]\d{1,14}$` |
| `UserResponse` | `phoneNumber` | `^\+[1-9]\d{1,14}$` |

All six rewritten to `pattern:` with the regex unchanged. The path parameters already
used `pattern` correctly, so the defect is confined to the schemas — which is itself
evidence that it is a slip rather than an intention.

**Why this is forced rather than cosmetic, measured rather than assumed.** Under
`strict: true` a validator *throws* on an unrecognised format, so the document cannot be
loaded at all. The tempting workaround is `strict: false`, and it is the wrong one:

```
strict: true  -> THROWS: unknown format "^01\d{6}$" ignored in schema at path "#"
strict: false -> compiled. 'GARBAGE' validates as an account number: true
```

Relaxing the setting does not make the constraint work. It makes the constraint
disappear, silently, and an account number of `GARBAGE` becomes valid. The loud failure
is the useful one, and it is what made all six findable.

---

## Corrective

### 4. `^tan-[A-Za-z0-9]$` matches exactly one character

Appears twice: as the `transactionId` path-parameter schema, and on
`TransactionResponse.id`. Widened to `^tan-[A-Za-z0-9]+$` at both sites.

The pattern is missing a quantifier, so it accepts `tan-a` and rejects `tan-123abc` —
**the document's own example, given directly beneath it.** A specification whose example
fails its own schema is not expressing a design choice.

The consequence differs at the two sites, and the second is the serious one:

- On the **path parameter**, it rejects every realistic transaction id, so the endpoint
  returns `400` for requests that should succeed.
- On the **response**, it makes conformance *unachievable*. The pattern admits exactly
  **62** distinct ids — verified by enumerating the character class — so no scheme both
  satisfies it and stays unique past the 62nd transaction.

### 6. `POST /v1/users` has a `400` with no body

Of the eleven `400` responses in the document as supplied, ten reference
`BadRequestErrorResponse` and one — user creation — carries only a description. Given
`BadRequestErrorResponse`, like the others.

Almost certainly an oversight, and it matters more than it looks: user creation is the
one endpoint a client reaches before authenticating, so its error shape is the first
thing any consumer integrates against.

*(Numbering skips 5. An earlier reading of this document recorded an `accountId` versus
`accountNumber` mismatch inside the specification. That was wrong — see the observations
below — and the item is retired rather than renumbered, so the count stays comparable
with the notes that referenced it.)*

---

## Unsatisfiable

These are the two places where the document contradicts itself, so no implementation can
satisfy it. Noticing that a specification is unsatisfiable is a different category from
noticing that it is untidy, which is why these are separated out.

### The balance ceiling

`BankAccountResponse.balance` declares `maximum: 10000.00`. `CreateTransactionRequest.amount`
also declares `maximum: 10000.00`. So two individually legal deposits produce a balance
the response schema cannot represent, and **nothing in the document defines a status for
refusing the second deposit.**

Every available behaviour breaks something:

| Behaviour | What breaks |
|---|---|
| Honour the ceiling | Requires inventing a status code the document does not define. |
| Ignore the ceiling | Serves a `200` whose body fails its own published schema. |

**Chosen: remove `maximum` from `BankAccountResponse.balance`** and let the balance grow.
It is the option that keeps every request/response pair self-consistent, and it confines
the deviation to one keyword in one place rather than spreading it across an invented
error path. `minimum: 0.00` is kept — a negative balance is a different claim, and this
service does not permit one. The cap on a single transaction amount is also kept, since
that one is satisfiable.

Recorded as risk **R9**. A real system would define a ceiling *and* the status for
breaching it, most likely `422`.

### The transaction id pattern

Corrective item 4 above. It is listed here as well because the response half is not
merely a defect — it is unsatisfiable in the same strict sense, and applying the fix is
what makes response validation possible rather than merely tidy.

---

## Additions

Not corrections. The document is not wrong here; this service publishes more than it was
handed.

### `409` on `POST /v1/users`

Created by forced change 1. Once a password exists, email becomes the login identifier,
so it must be unique — and duplicate signup becomes a reachable path with no status
defined for it. Added `409`, with `ErrorResponse`.

### `additionalProperties: false` on the success response schemas

**The word `additionalProperties` appears nowhere in the supplied document** — verified
by parsing it, not by reading. So this is an addition rather than a transcription, and it
is applied deliberately asymmetrically.

**Added** to `UserResponse` (including its nested `address`), `BankAccountResponse`,
`TransactionResponse`, `ListBankAccountsResponse`, `ListTransactionsResponse` and
`LoginResponse`.

**Not added** to any request schema, though this service enforces it at every ingress.

The asymmetry is the decision, and it divides on who bears the consequence:

- Closing a **response** schema documents a guarantee this service is making. It is what
  turns "no persistence entity and no password hash ever reaches a response body" from a
  review checklist item into a property a machine checks — a leaked `password_hash`
  becomes a `500` rather than a disclosure. Publishing it costs a client nothing.
- Closing a **request** schema imposes a new restriction on callers: a body that is legal
  under the document as published would start returning `400`. That is a larger claim to
  make on someone else's specification, and it belongs in a conversation rather than in a
  silent edit.

The cost of the second half is real and is stated rather than hidden: **the published
request schemas describe something looser than this service enforces.** That is precisely
the criticism this project levels at publishing a schema that under-describes its
endpoint, so it is recorded as risk **R30** rather than left as a convenient omission.

Note that `additionalProperties: false` is *not* inherited by nested objects. The nested
`address` inside `UserResponse` carries its own, without which
`{ "line1": "x", "isAdmin": true }` would validate.

The error schemas — `ErrorResponse` and `BadRequestErrorResponse` — are deliberately left
open. They are not on the egress-validation path, and the correlation id below extends
them; closing them would publish a shape a future member of the union could need to
change.

### `maxLength: 72` on `CreateUserRequest.password`

The document sets `minLength: 12` and no upper bound. bcrypt hashes the first 72 **bytes**
of its input and ignores the rest, so without a bound the service accepts a password it
does not fully honour: measured, `'a'.repeat(100)` authenticates against a hash of
`'a'.repeat(72)`.

Published rather than enforced silently, because it is a restriction on callers and a
client generated from this document should know about it — the asymmetry argued above for
`additionalProperties` cuts the other way here, since the constraint is one the service
genuinely cannot honour rather than one it merely chooses to impose.

`maxLength` counts characters and bcrypt counts bytes, so this bound is not exact for
non-ASCII passwords. **R36** carries the measurement and the keyword that would close it.

### `correlationId` on both error schemas

Every error envelope this service renders carries a `correlationId`, and it is published
as `required` on `ErrorResponse` and `BadRequestErrorResponse` because it is always
present rather than sometimes.

**It was already conformant before being published**, which is why this is an addition
rather than a correction: neither schema sets `additionalProperties: false`, so JSON
Schema's open-by-default rule permits the extra field. Publishing it anyway is the same
standard R30 holds the request schemas to — a document that under-describes what an
endpoint actually returns is the criticism this project makes of the supplied one.

It is the reason the id leaves the process at all. A user reporting a failure can quote
one string, and it selects every log record for that request.

### The `x-correlation-id` response header, which is returned but not published

The same id is set as a response header on **every** response, including successful ones,
which is the half the envelope cannot cover — a request that succeeded slowly has nothing
to quote otherwise.

It is deliberately not added to the document. OpenAPI 3.1 has no way to declare a header
that every response carries: `headers` is a property of each response object, so
publishing this one means adding it to roughly forty of them, by hand, with nothing
keeping them in step afterwards. That is a large edit whose only failure mode is silent
drift. The field on the error envelope is the published contract; the header is a
convenience that costs a client nothing to ignore.

### `GET /health`, which is the one addition deliberately *not* made to the document

The service answers `GET /health` with `{ "status": "ok" }`, and the specification is left
untouched. So this is a route the document does not describe, which is the mirror image of
every other entry in this file and is stated here rather than left to be discovered.

The reason it is not published is that it is not part of this API. The specification
describes a versioned resource API under `/v1`, and a liveness route is operational
tooling for whoever runs the service — a different audience, a different lifetime, and no
client of `/v1` should ever be written against it. Keeping it off the versioned path is
what makes that claim structural instead of a convention: there is no `/v1/health` to
mistake for part of the contract.

The reason it exists at all is narrower than the usual one, and worth being honest about
because the usual one does not hold here. Nothing in this repository consumes it: the app
is not containerised, there is no orchestrator and no load balancer, and the only
healthcheck in `compose.yml` belongs to Postgres. It exists because the first route
registered is what fixes the registration shape every later route copies, and every route
in the specification needs machinery — an error envelope, persistence — that this stage of
the build deliberately does not have yet. It is the only route that needs neither.

Note what that argument does not claim. Database health is already answered twice over, by
`docker compose up -d --wait` and by the test suite, so this endpoint is not a readiness
probe and does not touch the database. Making it one would mean deciding a `503` and a
degraded-status body, which is error-envelope design, and that belongs where the rest of
the envelope is decided.

---

## Observations — read, considered, not built

### `accountId` versus `accountNumber`

The accompanying scenarios refer to `accountId` throughout. The specification uses
`accountNumber` in every path template and every parameter — `accountId` appears **zero**
times in it.

So the mismatch is real but it is *between the two documents*, not inside the
specification. It is worth stating precisely, because the imprecise version — "the spec
is internally inconsistent about the account key" — is falsifiable in thirty seconds and
this build previously recorded it that way. The specification is right; the scenarios use
a different word for the same thing. No edit.

### A £0 transaction is permitted

`CreateTransactionRequest.amount` declares `minimum: 0.00`, so a zero-value deposit or
withdrawal is legal and creates a transaction row.

My preference is the opposite: `exclusiveMinimum: 0` and a `400`. Implemented as written
anyway, because the `400` would be a status the document does not sanction, and
conformance is the assessed property. Recorded as risk **R8**, which is a better outcome
than a silent deviation.

### `POST /v1/users` defines no `401` or `403`

Correct, and the scenarios disagree with it — they open the "create a user without all
required data" case with "Given a user has successfully authenticated". The specification
is right and the scenario preamble is boilerplate. Harmless; no edit.

### Five `403` descriptions name the wrong operation

This was carried into the build as "seven copy-pasted `403` descriptions". Counting them
shows the note was wrong in both directions — the count is different, and duplication is
not really the problem.

There are **ten** `403` responses. Five of them describe an operation other than the one
they sit on:

| Operation | Its `403` says |
|---|---|
| `POST /v1/accounts` | not allowed to access **the transaction** |
| `GET /v1/users/{userId}` | not allowed to access **the transaction** |
| `PATCH /v1/users/{userId}` | not allowed to access **the transaction** |
| `DELETE /v1/users/{userId}` | not allowed to access **the transaction** |
| `POST /v1/accounts/{accountNumber}/transactions` | not allowed to **delete the bank account details** |

So the wording was not copied onto similar operations — it was copied onto unrelated
ones, and the last row describes a create as a delete. Only one of the five sites
mentioning a transaction is actually about a transaction.

**Not edited.** It is documentation prose, it changes no behaviour, and the `403`
*semantics* — which this service does follow exactly — are unaffected. Recorded rather
than fixed because the distinction between a defect in what a document *says* and a
defect in what it *specifies* is worth keeping sharp, and because a reviewer who spots
this should find it already noted.

### `format: double` on money fields

Kept as-is. It is a registered OpenAPI format and validates nothing harmful. It is worth
knowing that it is an *annotation* rather than a constraint — the two-decimal-place rule
lives in prose in the `description`, and no keyword in the document enforces it. That gap
is closed on the service side rather than in the document.
