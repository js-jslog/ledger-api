import { expect, test } from 'vitest'

import { holdSharedResource, overlaps } from './shared-resource.js'

// One of a deliberate pair. Together with file-b.test.ts this asserts that
// `fileParallelism: false` in vitest.config.ts is genuinely in force, rather than
// being a setting nobody has checked. Deleting either file removes the proof.
test('file A holds a shared resource without overlapping another file', async () => {
  await holdSharedResource('A')

  expect(overlaps()).toEqual([])
})
