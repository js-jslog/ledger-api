import { currentCorrelationId } from './correlation.js'

export type Level = 'info' | 'warn' | 'error'

/**
 * Extra fields merged into a record. Deliberately an open index signature, which is why
 * the ban on logging request-body values cannot live here — an index signature accepts a
 * re-added `payload` in silence. It is enforced at the error constructors instead, by a
 * parameter type that makes `payload` a compile error. See `src/domain/errors.ts`.
 */
export type LogFields = Record<string, unknown>

/**
 * One JSON object per line on stdout, which is what a container collector expects and
 * what `JSON.stringify` already escapes correctly.
 *
 * The escaping is load-bearing rather than incidental: key names in `fields` can be
 * attacker-controlled (R25), and a line-oriented plaintext sink would make that a
 * log-injection vector. Changing this function is what would make that true.
 */
export const log = (level: Level, event: string, fields: LogFields = {}): void => {
  const record = {
    ...fields,
    time: new Date().toISOString(),
    level,
    event,
    correlationId: currentCorrelationId(),
  }

  process.stdout.write(`${JSON.stringify(record)}\n`)
}
