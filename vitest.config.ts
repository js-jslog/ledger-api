import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],

    // vitest defaults to running test *files* in parallel, verified rather than
    // assumed: `test/toolchain` is a pair of files that fail if they overlap, and
    // they do overlap with this set to `true`.
    //
    // Serialised execution is what makes a mutable resource shared across files
    // safe to reset between them.
    fileParallelism: false,

    // `isolate` is deliberately left at its default of `true`, which forks a fresh
    // process per file even with `fileParallelism: false`.
    //
    // Setting it `false` would collapse the run to a single process, sharing
    // anything expensive at module scope — a database connection pool, say —
    // rather than rebuilding it per file.
    //
    // Declined because `isolate: false` leaks module-level state between files,
    // which presents as a test that passes alone and fails in the suite, or the
    // reverse. That is an unmeasurable cost traded for a measurable one. Revisit if
    // the file count ever approaches Postgres's default `max_connections` of 100,
    // and make everything at module scope deliberate at the same time.
    // See docs/residual-risk-catalogue.md R12.

    globalSetup: ['./test/toolchain/reset-serialisation-log.ts'],
  },
})
