import type { AppData } from '../../types'
import type { SyncTransport } from '../sdk'

export const createTabSyncTransport = (channelName = 'neo-anki-sync'): SyncTransport | null => {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(channelName)
  return {
    publish: (data: AppData) => channel.postMessage(data),
    subscribe: (listener: (data: AppData) => void) => {
      const handler = (event: MessageEvent<AppData>) => listener(event.data)
      channel.addEventListener('message', handler)
      return () => channel.removeEventListener('message', handler)
    },
    close: () => channel.close(),
  }
}
