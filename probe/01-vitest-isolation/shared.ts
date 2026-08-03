import { appendFileSync } from 'node:fs'
export const LOG = '/tmp/claude-1000/-app/fc23d1a7-7111-4c7e-9c7a-ec5110fcd445/scratchpad/interleave.log'
/** Simulates "truncate the DB, then use it" — a critical section over a shared resource. */
export async function criticalSection(name: string): Promise<void> {
  appendFileSync(LOG, `enter-${name} pid=${process.pid}\n`)
  await new Promise((r) => setTimeout(r, 300))
  appendFileSync(LOG, `exit-${name}  pid=${process.pid}\n`)
}
