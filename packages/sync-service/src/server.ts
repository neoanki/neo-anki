import { resolve } from 'node:path'
import { EncryptedSyncService } from './index.js'
import { createSyncHttpServer } from './http.js'

const service = new EncryptedSyncService(resolve(process.env.NEO_ANKI_SYNC_DATABASE || 'neo-anki-sync.sqlite'))
const port = Math.max(1, Math.min(65_535, Number(process.env.PORT || 8787)))
const host = process.env.HOST || '127.0.0.1'
const server = createSyncHttpServer({
  service,
  allowedOrigins: (process.env.NEO_ANKI_SYNC_ALLOWED_ORIGINS || '').split(','),
  trustProxy: process.env.NEO_ANKI_SYNC_TRUST_PROXY === 'true',
  metricsToken: process.env.NEO_ANKI_SYNC_METRICS_TOKEN || '',
})

server.listen(port, host, () => process.stdout.write(`Neo Anki encrypted sync reference service listening on ${host}:${port}\n`))
const shutdown = () => server.close(() => { service.close(); process.exit(0) })
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown)
