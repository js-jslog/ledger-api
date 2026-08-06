import { expect, test } from 'vitest'

import { holdSharedResource, overlaps } from './shared-resource.js'

// See file-a.test.ts. The pair is the point; neither file proves anything alone.
test('file B holds a shared resource without overlapping another file', async () => {
  await holdSharedResource('B')

  expect(overlaps()).toEqual([])
})
