import { test } from 'vitest'
import { criticalSection } from './shared.js'
test('file A holds the shared resource', async () => { await criticalSection('A') })
