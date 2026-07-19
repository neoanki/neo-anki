import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createSyncHttpServer } from '../../packages/sync-service/src/http'
import { EncryptedSyncService } from '../../packages/sync-service/src/index'
import { generateDeviceSigningKeys } from '../../packages/sync-protocol/src/index'

describe('encrypted sync HTTP boundary', () => {
  it('protects content-blind metrics, enforces origins before mutation, and exposes bounded health metadata', async () => {
    const service = new EncryptedSyncService(); const metricsToken = 'metrics-token-with-at-least-32-characters'
    const server = createSyncHttpServer({ service, metricsToken, allowedOrigins: ['https://study.example'] })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const health = await fetch(`${endpoint}/health`)
      expect({ status: health.status, body: await health.json(), cache: health.headers.get('cache-control') }).toEqual({ status: 200, body: { ok: true, protocol: 1 }, cache: 'no-store' })

      expect((await fetch(`${endpoint}/v1/operator/metrics`)).status).toBe(404)
      expect((await fetch(`${endpoint}/v1/operator/metrics`, { headers: { authorization: 'Bearer wrong-token' } })).status).toBe(404)

      const signing = await generateDeviceSigningKeys(); const enrollment = { accountId: 'private-http-account', workspaceId: 'private-http-workspace', actorId: 'private-http-device', publicKeyJwk: await crypto.subtle.exportKey('jwk', signing.publicKey) }
      const rejected = await fetch(`${endpoint}/v1/accounts`, { method: 'POST', headers: { origin: 'https://malicious.example', 'content-type': 'application/json' }, body: JSON.stringify(enrollment) })
      expect(rejected.status).toBe(403)
      expect(service.operatorMetrics().accounts).toBe(0)

      const allowed = await fetch(`${endpoint}/v1/accounts`, { method: 'POST', headers: { origin: 'https://study.example', 'content-type': 'application/json' }, body: JSON.stringify(enrollment) })
      expect(allowed.status).toBe(201)
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://study.example')
      const preflight = await fetch(`${endpoint}/v1/pull`, { method: 'OPTIONS', headers: { origin: 'https://study.example' } })
      expect(preflight.status).toBe(204)

      const metricsResponse = await fetch(`${endpoint}/v1/operator/metrics`, { headers: { authorization: `Bearer ${metricsToken}` } })
      expect(metricsResponse.status).toBe(200)
      const serialized = JSON.stringify(await metricsResponse.json())
      expect(serialized).toContain('"accounts":1')
      for (const privateValue of ['private-http-account', 'private-http-workspace', 'private-http-device']) expect(serialized).not.toContain(privateValue)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve())); service.close()
    }
  })

  it('refuses weak operator credentials at construction', () => {
    const service = new EncryptedSyncService()
    try { expect(() => createSyncHttpServer({ service, metricsToken: 'too-short' })).toThrow('at least 32') }
    finally { service.close() }
  })
})
