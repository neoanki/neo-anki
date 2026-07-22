import type { ExtensionHostV2 } from '../../../packages/extension-sdk/src/index.js'
import { extensionCapabilityToken } from '../host.js'

const unavailable = () => Promise.reject(new Error('SDK v2 capabilities require the Neo Anki desktop app.'))
const toBase64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary) }
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

export const createExtensionHostV2 = (extensionId: string): ExtensionHostV2 => {
  const bridge = window.neoAnkiDesktop
  const token = extensionCapabilityToken(extensionId)
  if (!bridge || !token) return { applyPatch: unavailable, createMedia: unavailable, fetch: unavailable, cancel: unavailable, secrets: { read: unavailable, mutate: unavailable }, config: { read: unavailable, write: unavailable }, content: { listNotes: unavailable }, migration: { exportWorkspace: unavailable, commit: unavailable } }
  return {
    applyPatch: async (patch) => {
      const result = await bridge.extensionApplyPatchV2(token, patch)
      window.dispatchEvent(new CustomEvent('neo-anki:workspace-updated-v4', { detail: result.data }))
      return { workspaceRevision: result.workspaceRevision }
    },
    createMedia: async (request) => {
      const result = await bridge.extensionCreateMediaV2(token, request)
      window.dispatchEvent(new CustomEvent('neo-anki:workspace-reload-requested'))
      return result
    },
    fetch: async (request) => {
      const result = await bridge.extensionNetworkFetch(token, { operationId: request.operationId, url: request.url, method: request.method, headers: request.headers, bodyBase64: request.body ? toBase64(request.body) : undefined, timeoutMs: request.timeoutMs, maximumResponseBytes: request.maximumResponseBytes })
      return { status: result.status, headers: result.headers, body: fromBase64(result.bodyBase64) }
    },
    cancel: async (operationId) => bridge.extensionCancelV2(token, operationId),
    secrets: {
      read: (keys) => bridge.extensionSecretReadBatchV2(token, keys),
      mutate: (changes) => bridge.extensionSecretMutateBatchV2(token, changes),
    },
    config: {
      read: <T = unknown>() => bridge.extensionConfigReadV2(token) as Promise<T | null>,
      write: async (value) => {
        const result = await bridge.extensionConfigWriteV2(token, value)
        window.dispatchEvent(new CustomEvent('neo-anki:workspace-updated-v4', { detail: result.data }))
        return { workspaceRevision: result.workspaceRevision }
      },
    },
    content: { listNotes: (query = {}) => bridge.extensionContentListNotesV2(token, query) },
    migration: {
      exportWorkspace: () => bridge.extensionMigrationExportV2(token),
      commit: async (input) => {
        const result = await bridge.extensionMigrationCommitV2(token, input)
        window.dispatchEvent(new CustomEvent('neo-anki:migration-committed-v4', { detail: { extensionId, data: result.data } }))
        window.dispatchEvent(new CustomEvent('neo-anki:workspace-updated-v4', { detail: result.data }))
        return { workspaceRevision: result.workspaceRevision }
      },
    },
  }
}
