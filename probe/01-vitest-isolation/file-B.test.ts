import { test } from 'vitest'
import { criticalSection } from './shared.js'
test('file B holds the shared resource', async () => { await criticalSection('B') })
