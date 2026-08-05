import express, { type Express } from 'express'

import { health } from './health.js'

/**
 * The composition root. Every route this service answers is registered here, one line
 * each, and there is no registry, no decorator and no filesystem scan between this file
 * and the handler it names — so the list of routes is readable in one place and adding
 * one is a single line.
 *
 * It returns the app rather than starting it. `src/main.ts` is the only thing that
 * listens, which is what lets a test drive the whole HTTP stack without a port.
 */
export const createApp = (): Express => {
  const app = express()

  app.get('/health', health)

  return app
}
