import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['probes/**/*.test.ts', 'src/**/*.test.ts'],
    /**
     * FINDING (see NOTES.md): every integration test file shares the one Postgres
     * from compose, and each truncates the tables it uses. Vitest runs test *files*
     * in parallel worker threads by default, so files silently delete each other's
     * fixtures and fail with "no result" — a failure mode that looks like a
     * connection bug and is not. Options were: a schema (or database) per worker,
     * transaction-rollback isolation per test, or serialising files. Serial is
     * chosen here for legibility; the cost is wall-clock, which is fine at this size.
     */
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
