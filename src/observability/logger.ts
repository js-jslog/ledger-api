/**
 * The log sink.
 *
 * Deliberately tiny — a real build would use pino. What matters for this probe is
 * the *shape* of the contract, because two properties of it are load-bearing:
 *
 *   1. It is replaceable, so tests can assert on records rather than hope. Once
 *      error construction logs (see `src/domain/errors.ts`), the log output is a
 *      behaviour of the system and it should be tested like one.
 *   2. It is silent by default under test, because log-at-construction means every
 *      test that builds an error would otherwise print. That is the cost of the
 *      design and this is where it is paid.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export type LogRecord = {
  readonly level: LogLevel
  readonly event: string
  /** Minted once per request. The key the collector stitches records by. */
  readonly correlationId: string
  readonly [field: string]: unknown
}

export type LogSink = (record: LogRecord) => void

const stderrSink: LogSink = (record) => {
  process.stderr.write(`${JSON.stringify(record)}\n`)
}

const silentSink: LogSink = () => {
  /* nothing */
}

/**
 * Under vitest, `NODE_ENV` is `test`. Defaulting to silent there keeps suite output
 * readable; a test that cares installs a capturing sink explicitly.
 */
let sink: LogSink = process.env.NODE_ENV === 'test' ? silentSink : stderrSink

export function setLogSink(next: LogSink): void {
  sink = next
}

export function resetLogSink(): void {
  sink = process.env.NODE_ENV === 'test' ? silentSink : stderrSink
}

/** Installs a capturing sink and returns the array it fills. For tests. */
export function captureLogs(): LogRecord[] {
  const records: LogRecord[] = []
  setLogSink((record) => records.push(record))
  return records
}

export function emit(record: LogRecord): void {
  sink(record)
}
