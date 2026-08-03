import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // §4 says "truncate between tests, single worker" and marks it [unverified].
    // Probe 01 verified it, and it takes two settings, not one:
    //
    //   fileParallelism: false  -- vitest 4 runs test FILES concurrently by
    //     default. Observed: two files entering a shared critical section
    //     interleaved (enter-B, enter-A, exit-A, exit-B) across two pids.
    //     Truncate-between-tests against one Postgres is flaky without this.
    //
    //   isolate: false  -- the non-obvious one. Under the default isolate:true,
    //     vitest forks a FRESH process per file even with
    //     poolOptions.forks.singleFork set, so a module-level pg Pool is rebuilt
    //     per file rather than shared. Setting it false collapses the run to a
    //     single pid, which is what makes one shared Pool and one shared
    //     truncate helper possible.
    //
    // The cost of isolate:false is real and worth stating out loud: module state
    // leaks between files, so anything cached at module scope must be deliberate.
    fileParallelism: false,
    isolate: false,
  },
})
