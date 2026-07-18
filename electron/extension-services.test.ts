import { describe, expect, it, vi } from 'vitest'
import { ExtensionServices } from './extension-services.js'
import type { ExtensionManager } from './extension-manager.js'

const manager = (domains = ['api.example.com', 'cdn.example.com']) => ({
  requireEnabled: vi.fn(async () => ({ schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.fixture', permissions: ['network:fetch'], networkDomains: domains })),
  requirePermission: vi.fn(async (_id: string, permission: string) => {
    if (permission !== 'network:fetch') throw new Error('permission denied')
    return { schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.fixture', permissions: ['network:fetch'], networkDomains: domains }
  }),
}) as unknown as ExtensionManager

const claimed = async (fetcher: typeof fetch, domains?: string[]) => {
  const services = new ExtensionServices('/tmp/neoanki-extension-services-test', manager(domains), fetcher)
  return { services, token: await services.claim('org.neoanki.fixture') }
}

describe('extension network mediation', () => {
  it('revokes renderer-scoped capability handles so reload can claim a fresh one', async () => {
    const services = new ExtensionServices('/tmp/neoanki-extension-services-test', manager(), async () => new Response())
    const first = await services.claim('org.neoanki.fixture')
    await expect(services.claim('org.neoanki.fixture')).rejects.toThrow('already claimed')
    services.release('org.neoanki.fixture')
    const second = await services.claim('org.neoanki.fixture')
    expect(second).not.toBe(first)
    await expect(services.authorize(first, 'content:read')).rejects.toThrow('invalid or expired')
  })

  it('revalidates every redirect and strips credentials when the allowed host changes', async () => {
    const calls: Array<{ url: string; authorization?: string }> = []
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input); calls.push({ url, authorization: new Headers(init?.headers).get('authorization') || undefined })
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/audio' } })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    })
    const { services, token } = await claimed(fetcher)
    await expect(services.fetch(token, { url: 'https://api.example.com/generate', headers: { authorization: 'Bearer device-secret' } })).resolves.toMatchObject({ status: 200 })
    expect(calls).toEqual([
      { url: 'https://api.example.com/generate', authorization: 'Bearer device-secret' },
      { url: 'https://cdn.example.com/audio', authorization: undefined },
    ])

    const forbidden = await claimed(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/audio' } }))
    await expect(forbidden.services.fetch(forbidden.token, { url: 'https://api.example.com/generate' })).rejects.toThrow(/not allowed to contact evil\.example/)
  })

  it('cancels the response stream immediately when the declared byte cap is exceeded', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])) },
      cancel() { cancelled = true },
    })
    const { services, token } = await claimed(async () => new Response(stream, { status: 200 }))
    await expect(services.fetch(token, { url: 'https://api.example.com/large', maximumResponseBytes: 3 })).rejects.toThrow(/exceeds 3 bytes/)
    expect(cancelled).toBe(true)
  })

  it('aborts an active mediated request by its extension-scoped operation id', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const { services, token } = await claimed(fetcher)
    const pending = services.fetch(token, { operationId: 'generation-1', url: 'https://api.example.com/generate' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    services.cancel(token, 'generation-1')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
