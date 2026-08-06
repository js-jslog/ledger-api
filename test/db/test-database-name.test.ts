import { expect, test } from 'vitest'

import { DEFAULT_DATABASE_URL, DEFAULT_TEST_DATABASE_URL } from '../../src/db/connection.js'

import { assertTestDatabase, databaseNameOf } from './test-database-name.js'

test('reads the database name out of a connection string', () => {
  expect(databaseNameOf(DEFAULT_TEST_DATABASE_URL)).toBe('ledger_test')
  expect(databaseNameOf(DEFAULT_DATABASE_URL)).toBe('ledger')
})

test('admits a database whose name ends in _test', () => {
  expect(assertTestDatabase(DEFAULT_TEST_DATABASE_URL)).toBe('ledger_test')
})

// The test that matters. The default development database is a real database this
// compose file creates, so this is the guard refusing the exact string it exists to
// refuse, rather than a contrived name.
test('refuses the development database', () => {
  expect(() => assertTestDatabase(DEFAULT_DATABASE_URL)).toThrow(/does not end in "_test"/)
})

test.each([
  ['no database at all', 'postgres://ledger:ledger@localhost:55432/'],
  ['a name merely containing _test', 'postgres://ledger:ledger@localhost:55432/ledger_test_backup'],
  ['a name differing in case', 'postgres://ledger:ledger@localhost:55432/ledger_TEST'],
  ['production, in as many words', 'postgres://ledger:ledger@db.internal:5432/ledger_production'],
])('refuses %s', (_description, connectionString) => {
  expect(() => assertTestDatabase(connectionString)).toThrow(/does not end in "_test"/)
})
