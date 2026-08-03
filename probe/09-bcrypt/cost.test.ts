import bcrypt from 'bcryptjs'
import { describe, expect, test } from 'vitest'

/**
 * §4: "Password hashing | `bcryptjs` | Pure JS, no native compilation, so
 * `npm ci` cannot break on an unknown reviewer machine. **Accepts chunked
 * on-thread hashing as the cost.**"
 *
 * The decision looks right. The cost is accepted without a number attached, and
 * "chunked" is an assumption about the async API worth checking, because if it is
 * wrong then every signup and every login stalls the whole process.
 */

const COST = 10

describe('what the accepted cost actually is', () => {
  test('a single hash at cost 10, measured', async () => {
    const start = performance.now()
    await bcrypt.hash('correct-horse-battery', COST)
    const elapsed = performance.now() - start
    console.log(`bcryptjs hash at cost ${String(COST)}: ${elapsed.toFixed(0)}ms`)
    // Deliberately loose -- this records an order of magnitude, not a budget.
    expect(elapsed).toBeGreaterThan(0)
  })

  test('the async API barely chunks: §4\'s "chunked" is close to non-existent', async () => {
    // §4 accepts "chunked on-thread hashing as the cost", which implies the async
    // API interleaves with other work. Measured against a baseline of what a
    // genuinely yielding 50ms of work looks like, it does not.
    const tickDuring = async (work: () => Promise<unknown>): Promise<{ ticks: number; ms: number }> => {
      let ticks = 0
      const timer = setInterval(() => {
        ticks++
      }, 1)
      const start = performance.now()
      await work()
      const ms = performance.now() - start
      clearInterval(timer)
      return { ticks, ms }
    }

    // Baseline: 50ms spent in a way that definitely yields every millisecond.
    const baseline = await tickDuring(async () => {
      const until = performance.now() + 50
      while (performance.now() < until) await new Promise((r) => setTimeout(r, 1))
    })

    const hashing = await tickDuring(() => bcrypt.hash('correct-horse-battery', COST))

    console.log(
      `yielding baseline: ${String(baseline.ticks)} ticks in ${baseline.ms.toFixed(0)}ms; ` +
        `bcryptjs async: ${String(hashing.ticks)} ticks in ${hashing.ms.toFixed(0)}ms`,
    )

    // It does yield at least once -- so it is not the same as hashSync -- but it
    // is an order of magnitude away from the baseline. Practically, a hash holds
    // the loop for tens of milliseconds regardless of which API you call.
    expect(hashing.ticks).toBeGreaterThan(0)
    expect(hashing.ticks).toBeLessThan(baseline.ticks / 3)
  })

  test('the SYNCHRONOUS API is the trap, and it is one letter away', async () => {
    // bcrypt.hashSync is the same call with four more characters, appears in most
    // examples, and blocks the process for the full duration. In a single-process
    // Node service that is a hard cap on concurrent logins.
    let ticks = 0
    const timer = setInterval(() => {
      ticks++
    }, 5)

    const start = performance.now()
    bcrypt.hashSync('correct-horse-battery', COST)
    const elapsed = performance.now() - start
    clearInterval(timer)

    console.log(`hashSync blocked for ${elapsed.toFixed(0)}ms; loop ticked ${String(ticks)} times`)
    // Nothing else ran. This is the assertion that makes the async choice matter.
    expect(ticks).toBe(0)
  })

  test('concurrent hashes serialise on the single thread', async () => {
    // The consequence of "on-thread": ten concurrent signups do not overlap, they
    // queue. Total time scales linearly, which is the throughput statement the
    // ADR should carry.
    const one = performance.now()
    await bcrypt.hash('x', COST)
    const singleMs = performance.now() - one

    const many = performance.now()
    await Promise.all(Array.from({ length: 10 }, () => bcrypt.hash('x', COST)))
    const tenMs = performance.now() - many

    console.log(
      `1 hash: ${singleMs.toFixed(0)}ms; 10 concurrent: ${tenMs.toFixed(0)}ms` +
        ` (${(tenMs / singleMs).toFixed(1)}x)`,
    )
    // Closer to 10x than to 1x -- no parallelism to be had.
    expect(tenMs).toBeGreaterThan(singleMs * 4)
  })

  test('verification costs the same as hashing, so login is as expensive as signup', async () => {
    const hash = await bcrypt.hash('correct-horse-battery', COST)
    const start = performance.now()
    await bcrypt.compare('correct-horse-battery', hash)
    const elapsed = performance.now() - start
    console.log(`bcryptjs compare: ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeGreaterThan(0)
  })
})
