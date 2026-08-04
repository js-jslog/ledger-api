/**
 * The Kysely database interface. It carries no domain tables, and that is the
 * decision rather than an omission: `users`, `accounts` and `transactions` arrive
 * with the steps that read them, each alongside its own migration.
 *
 * The reason is that the migrations are where the money representation and the
 * trigger-maintained timestamps are actually settled — `INTEGER` rather than int8 or
 * `numeric` because both of those come back as strings and make a column declaration
 * here a lie that `strict: true` cannot catch, and `ColumnType<Date, never, never>`
 * because it is what turns an application-side timestamp write into a compile error.
 * Those are domain decisions, and putting them in the step everybody agrees is
 * plumbing is how they get waved through.
 */
export type Database = {
  migration_pipeline_proof: MigrationPipelineProofTable
}

/**
 * The only table this slice creates, and it exists to be read by the test that
 * proves the migration pipeline works end to end — schema file to migrator to a
 * typed query against the result. A migration nothing reads would leave the suite
 * green without asserting anything.
 *
 * It is not a domain table and is not a placeholder for one. It goes when the first
 * real migration arrives.
 */
export type MigrationPipelineProofTable = {
  note: string
}
