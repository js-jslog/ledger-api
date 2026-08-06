import { afterEach, beforeEach, vi } from 'vitest'

/**
 * Every error logs at construction, so any test that builds one writes a line to stdout
 * — which buries the suite's own output in JSON for the many tests that are not about
 * logging at all.
 *
 * So this does both jobs at once: it silences the sink, and it hands back what was
 * written for the tests that do assert on it. A test that only wants the quiet can
 * discard the return value.
 *
 * It registers its own hooks, so call it once at the top of a file or a describe.
 */
export const capturedLogs = (): (() => Record<string, unknown>[]) => {
  let written: string[] = []

  beforeEach(() => {
    written = []

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
      written.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  return () =>
    written
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
}
