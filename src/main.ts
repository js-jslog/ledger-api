import { connect } from './db/connect.js'
import { makeApp } from './http/app.js'

const port = Number(process.env.PORT ?? 3000)
const connectionString = process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost:5432/ledger'
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) {
  // Fail fast rather than defaulting. A dev-default JWT secret that reaches
  // production is the single most common way this class of service is compromised.
  console.error('JWT_SECRET is required')
  process.exit(1)
}

const db = connect(connectionString)
makeApp(db, jwtSecret).listen(port, () => {
  console.log(`ledger-api listening on ${port}`)
})
