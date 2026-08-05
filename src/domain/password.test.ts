import { describe, expect, test } from 'vitest'

import { DEFAULT_BCRYPT_COST, bcryptCost } from './password.js'

describe('bcryptCost', () => {
  test('defaults to the working cost when nothing is configured', () => {
    expect(bcryptCost({})).toBe(DEFAULT_BCRYPT_COST)
  })

  test('reads the configured cost', () => {
    expect(bcryptCost({ BCRYPT_COST: '4' })).toBe(4)
  })

  // The suite itself depends on this: `vitest.config.ts` sets the variable, and a typo
  // there that silently fell back to 12 would present as a slow suite rather than as a
  // configuration error.
  test.each(['', 'twelve', '3', '32', '10.5'])('refuses %o rather than falling back', (value) => {
    expect(() => bcryptCost({ BCRYPT_COST: value })).toThrow(/BCRYPT_COST/)
  })

  test('the suite is running at the configured cost, not the default', () => {
    expect(bcryptCost()).toBe(4)
  })
})
