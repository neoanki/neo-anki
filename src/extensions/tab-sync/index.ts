import type { NeoAnkiExtension } from '../sdk'
import { createTabSyncTransport } from './transport'

export const tabSyncExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.tab-sync',
    name: 'Browser Tab Sync',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['sync:transport'],
  },
  syncTransports: [{
    id: 'broadcast-channel',
    create: createTabSyncTransport,
  }],
}

export { createTabSyncTransport } from './transport'
