import { defineExtension, exposeExtensionWorker } from '@neo-anki/extension-sdk'

const extension = defineExtension({
  manifest: {
    format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id: 'org.neoanki.examples.study-pulse', name: 'Study Pulse', version: '2.1.0', publisher: 'Neo Anki SDK examples', publisherKey: 'MCowBQYDK2VwAyEA7Dj6QuonLpqmdZFSdx/OSSvjXv0C5UxiwVm1p5OA0xU=', permissions: ['study:signals', 'ui:page'], workerEntry: 'dist/worker.js', uiEntries: [{ id: 'study-pulse', surface: 'page', entry: 'dist/page.js' }], provenance: { sourceCommit: '08abef4294b9558ee02878d21bc397af94113a5b', buildSystem: 'neo-anki-extension-cli' },
  },
  async handle(request) {
    if (request.type === 'command' && request.commandId === 'isolation-probe') {
      const globals = globalThis as typeof globalThis & Record<string, unknown>
      const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'BroadcastChannel', 'indexedDB'].every((name) => globals[name] === undefined)
      return { type: 'result', requestId: request.requestId, value: { blocked } }
    }
    if (request.type !== 'planning-signals') return { type: 'error', requestId: request.type === 'command' ? request.requestId : request.operationId, code: 'unsupported', message: 'Unsupported contribution.' }
    return { type: 'planning-signals', requestId: request.request.requestId, signals: request.request.items.filter((item) => !item.suspended && item.dueAt).map((item) => ({ itemId: item.noteId, score: new Date(item.dueAt!).getTime() <= new Date(request.request.now).getTime() ? .1 : 0, reason: 'Study Pulse due signal' })) }
  },
})

exposeExtensionWorker(extension)
