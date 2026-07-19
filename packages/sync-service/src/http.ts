import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { EncryptedSyncService } from './index.js'

const MAX_BODY_BYTES = 20 * 1024 * 1024

export interface SyncHttpServerOptions {
  service: EncryptedSyncService
  allowedOrigins?: Iterable<string>
  trustProxy?: boolean
  metricsToken?: string
}

const parseBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []; let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk); total += bytes.byteLength
    if (total > MAX_BODY_BYTES) throw new Error('Request body exceeds 20 MiB.')
    chunks.push(bytes)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
}

const tokenMatches = (candidate: string, expected: string) => {
  const left = createHash('sha256').update(candidate).digest(); const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

/** Creates the content-blind HTTP boundary without listening or process side effects. */
export const createSyncHttpServer = ({ service, allowedOrigins = [], trustProxy = false, metricsToken = '' }: SyncHttpServerOptions) => {
  if (metricsToken && metricsToken.length < 32) throw new Error('The sync metrics token must contain at least 32 characters.')
  const origins = new Set([...allowedOrigins].map((value) => value.trim()).filter(Boolean))
  const remoteAddress = (request: IncomingMessage) => {
    if (trustProxy) {
      const forwarded = request.headers['x-forwarded-for']; const candidate = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim()
      if (isIP(candidate)) return candidate
    }
    return request.socket.remoteAddress || 'unknown'
  }
  const json = (response: ServerResponse, status: number, value: unknown, origin = '') => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...(origin && origins.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) })
    response.end(JSON.stringify(value))
  }

  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin || ''
      if (origin && !origins.has(origin)) { json(response, 403, { error: 'Origin is not allowed.' }); return }
      const remote = remoteAddress(request)
      if (service.rateLimitExceeded(`all:${remote}`, 600)) { response.setHeader('retry-after', '60'); json(response, 429, { error: 'Too many sync requests. Retry after one minute.' }, origin); return }
      if (request.method === 'POST' && (request.url === '/v1/accounts' || request.url === '/v1/recovery/devices') && service.rateLimitExceeded(`enroll:${remote}`, 10)) { response.setHeader('retry-after', '60'); json(response, 429, { error: 'Too many enrollment attempts. Retry after one minute.' }, origin); return }
      if (request.method === 'OPTIONS') { if (!origin) throw new Error('Origin is required.'); response.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', vary: 'Origin' }); response.end(); return }
      if (request.method === 'GET' && request.url === '/health') { json(response, 200, { ok: true, protocol: 1 }, origin); return }
      if (request.method === 'GET' && request.url === '/v1/operator/metrics') {
        const candidate = request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
        if (!metricsToken || !candidate || !tokenMatches(candidate, metricsToken)) { json(response, 404, { error: 'not-found' }, origin); return }
        json(response, 200, service.operatorMetrics(), origin); return
      }
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
      const input = await parseBody(request)
      const keyMatch = /^\/v1\/devices\/([^/]+)\/key$/.exec(request.url || '')
      const mediaMatch = /^\/v1\/media\/([^/]+)\/chunks\/(\d+)$/.exec(request.url || '')
      const snapshotChunkMatch = /^\/v1\/snapshots\/([^/]+)\/chunks\/(\d+)$/.exec(request.url || '')
      if (request.method === 'POST' && request.url === '/v1/accounts') json(response, 201, service.enrollFirstDevice(input as never), origin)
      else if (request.method === 'POST' && request.url === '/v1/recovery/devices') json(response, 201, service.recoverDevice(input as never), origin)
      else if (request.method === 'POST' && request.url === '/v1/devices') json(response, 201, service.enrollDevice(token, input as never), origin)
      else if (request.method === 'POST' && request.url === '/v1/recovery/rotate') json(response, 200, { recoveryToken: service.rotateRecoveryToken(token) }, origin)
      else if (request.method === 'POST' && request.url === '/v1/devices/revoke') { service.revokeDevice(token, String(input.actorId)); json(response, 200, { revoked: true }, origin) }
      else if (request.method === 'GET' && request.url === '/v1/devices') json(response, 200, { devices: service.listDevices(token) }, origin)
      else if (request.method === 'GET' && keyMatch) json(response, 200, service.devicePublicKey(token, decodeURIComponent(keyMatch[1])), origin)
      else if (request.method === 'POST' && request.url === '/v1/operations') json(response, 200, { cursor: await service.push(token, input.operations as never) }, origin)
      else if (request.method === 'POST' && request.url === '/v1/pull') json(response, 200, service.pull(token, input.after as never, Number(input.limit || 10_000)), origin)
      else if (request.method === 'POST' && request.url === '/v1/acknowledgements') json(response, 200, service.acknowledge(token, input.cursor as never), origin)
      else if (request.method === 'POST' && request.url === '/v1/snapshots') json(response, 201, { id: service.putSnapshot(token, input.snapshot as never) }, origin)
      else if (request.method === 'PUT' && snapshotChunkMatch) { service.putSnapshotChunk(token, input.chunk as never); json(response, 200, { stored: true }, origin) }
      else if (request.method === 'GET' && snapshotChunkMatch) json(response, 200, { chunk: service.getSnapshotChunk(token, decodeURIComponent(snapshotChunkMatch[1]), Number(snapshotChunkMatch[2])) }, origin)
      else if (request.method === 'POST' && request.url === '/v1/snapshot-manifests') json(response, 201, { id: service.commitSnapshotManifest(token, input.manifest as never) }, origin)
      else if (request.method === 'POST' && request.url === '/v1/media-manifests') { service.commitMediaManifest(token, input.manifest as never); json(response, 201, { committed: true }, origin) }
      else if (request.method === 'PUT' && mediaMatch) { service.putMediaChunk(token, input.chunk as never); json(response, 200, { stored: true }, origin) }
      else if (request.method === 'GET' && mediaMatch) json(response, 200, { chunk: service.getMediaChunk(token, decodeURIComponent(mediaMatch[1]), Number(mediaMatch[2])) }, origin)
      else if (request.method === 'DELETE' && request.url === '/v1/account') { service.deleteAccount(token); json(response, 200, { deleted: true }, origin) }
      else json(response, 404, { error: 'not-found' }, origin)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      const status = /authorization|revoked/i.test(message) ? 401 : /exceeds|too large|quota/i.test(message) ? 413 : 400
      json(response, status, { error: message }, request.headers.origin || '')
    }
  })
  server.requestTimeout = 35_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 100
  return server
}
