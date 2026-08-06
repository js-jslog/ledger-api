import { appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Under the OS temp directory rather than a path baked into the repository, so
// the proof runs anywhere — including on a reviewer's machine.
export const LOG = join(tmpdir(), 'ledger-api-file-serialisation.log')

/**
 * Stands in for "reset the database schema, then use it": a critical section over
 * a resource every test file shares. The delay is long enough that two files
 * running concurrently are certain to overlap.
 */
export const holdSharedResource = async (name: string): Promise<void> => {
  appendFileSync(LOG, `enter ${name} pid=${process.pid}\n`)
  await new Promise((resolve) => setTimeout(resolve, 200))
  appendFileSync(LOG, `exit ${name} pid=${process.pid}\n`)
}

/**
 * Every `enter` must be closed by its own `exit` before the next `enter` begins.
 *
 * The check is order-independent, so both test files can assert it without either
 * needing to know which ran first. Whichever runs first sees only its own pair and
 * passes trivially; the one that runs second does the real work. Under parallel
 * execution at least one of them observes an open section and fails, which is all
 * that is needed.
 */
export const overlaps = (): string[] => {
  const found: string[] = []
  let open: string | null = null

  for (const line of readFileSync(LOG, 'utf8').trim().split('\n')) {
    const [event, name = '(unnamed)'] = line.split(' ')
    if (event !== 'enter') {
      open = null
      continue
    }
    if (open !== null) found.push(`${name} entered while ${open} was still inside`)
    open = name
  }

  return found
}
