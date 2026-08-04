/**
 * The guard standing in front of `drop schema public cascade`.
 *
 * A `drop schema public cascade` pointed at the wrong connection string is the single
 * worst thing this repository could contain, and the sequence that produces it is
 * ordinary: `DATABASE_URL` exported in a shell, a test run started in that shell, and
 * the destructive helper aimed at a live database.
 *
 * Three properties are deliberate.
 *
 * **It is a pure function over a string**, so it can be tested by calling it — and
 * tested FIRING, which is the only test that matters here. Inline at the call site it
 * could only be exercised by pointing a real reset at a real database, which is the
 * one experiment nobody should run.
 *
 * **It throws rather than returning a `Result`.** The codebase is errors-as-values,
 * and this is the exception that proves the rule: a `Result` is a value a caller can
 * hold and ignore, and the whole purpose here is that there is no way past. Compare
 * the repository port taking no balance — the same structural argument, that the
 * dangerous thing should be inexpressible rather than merely discouraged.
 *
 * **It takes the connection string, not a database name.** Handing it a name would
 * let a caller check one string and connect with another; taking the string means the
 * thing asserted and the thing connected to are the same value.
 */

export const databaseNameOf = (connectionString: string): string =>
  new URL(connectionString).pathname.replace(/^\//, '')

export const assertTestDatabase = (connectionString: string): string => {
  const name = databaseNameOf(connectionString)

  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing a destructive operation: database ${JSON.stringify(name)} does not end in "_test". ` +
        'Set TEST_DATABASE_URL to a test database, or leave it unset to use the default.',
    )
  }

  return name
}
