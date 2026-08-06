import { connect, databaseUrl } from './db/connection.js'
import { createApp } from './http/app.js'

const port = Number(process.env['PORT'] ?? 3000)

createApp(connect(databaseUrl())).listen(port, () => {
  console.log(`Listening on http://localhost:${String(port)}`)
})
