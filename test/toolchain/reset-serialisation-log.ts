import { writeFileSync } from 'node:fs'

import { LOG } from './shared-resource.js'

/**
 * Runs once in the main vitest process, before any test file. Truncates the log so
 * a run is never judged on records left behind by the previous one.
 */
export const setup = (): void => {
  writeFileSync(LOG, '')
}
