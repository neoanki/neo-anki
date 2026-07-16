import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { createTabSyncTransport, mergeAppData } from './sync'

describe('deterministic sync merge', () => {
  it('keeps newest mutable records and unions immutable reviews', () => {
    const local = createSeedData()
    const remote = structuredClone(local)
    remote.deviceId = 'remote'
    remote.items[0].answer = 'Remote newest answer'
    remote.items[0].updatedAt = '2099-01-01T00:00:00Z'
    remote.updatedAt = '2099-01-01T00:00:00Z'
    remote.reviews.push({ id: 'remote-review', cardId: remote.cards[0].id, rating: 3, reviewedAt: '2099-01-01T00:00:00Z', durationSeconds: 10, previousDue: '', nextDue: '' })
    const merged = mergeAppData(local, remote)
    expect(merged.deviceId).toBe(local.deviceId)
    expect(merged.items[0].answer).toBe('Remote newest answer')
    expect(merged.reviews.some((review) => review.id === 'remote-review')).toBe(true)
  })
  it('publishes and receives through the pluggable tab transport', () => {
    const original = globalThis.BroadcastChannel
    let handler: ((event: MessageEvent) => void) | undefined
    const posted: unknown[] = []
    class FakeChannel {
      closed = false
      postMessage(value: unknown) { posted.push(value) }
      addEventListener(_name: string, callback: (event: MessageEvent) => void) { handler = callback }
      removeEventListener() { handler = undefined }
      close() { this.closed = true }
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true })
    const transport = createTabSyncTransport('test')!
    let received = ''
    const unsubscribe = transport.subscribe((value) => { received = value.deviceId })
    const data = createSeedData()
    transport.publish(data)
    handler?.({ data } as MessageEvent)
    expect(posted).toEqual([data]); expect(received).toBe(data.deviceId)
    unsubscribe()
    transport.close?.()
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: original, configurable: true })
  })
})
