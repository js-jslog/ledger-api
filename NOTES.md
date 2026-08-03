# Probe log

Experimental repo probing `build-brief.md`'s settled decisions for problems that
would surface in a slower, human-supervised build. Each `probes/pNN-*.ts` file is
a self-contained demonstration of one claim holding or failing.

| # | Claim under test | Verdict |
|---|---|---|
| 01 | `json-schema-to-ts` gives compile-time types from the same schema Ajv validates | HOLDS |
