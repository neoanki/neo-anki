import type { ExtensionHost } from './sdk'

const desktopRequired = () => Promise.reject(new Error('This extension capability requires the Neo Anki desktop app.'))
const tokens = new Map<string, string>()

export const prepareExtensionHost = async (extensionId: string) => {
  if (!window.neoAnkiDesktop || tokens.has(extensionId)) return
  tokens.set(extensionId, await window.neoAnkiDesktop.claimExtensionCapability(extensionId))
}

export const createExtensionHost = (extensionId: string): ExtensionHost => {
  const desktop = window.neoAnkiDesktop
  const token = tokens.get(extensionId)
  if (!desktop || !token) {
    return {
      platform: 'web',
      network: { fetch: desktopRequired },
      secrets: { has: desktopRequired, get: desktopRequired, set: desktopRequired, delete: desktopRequired },
    }
  }
  return {
    platform: 'desktop',
    network: { fetch: (request) => desktop.extensionNetworkFetch(token, request) },
    secrets: {
      has: (key) => desktop.extensionSecretHas(token, key),
      get: (key) => desktop.extensionSecretGet(token, key),
      set: (key, value) => desktop.extensionSecretSet(token, key, value),
      delete: (key) => desktop.extensionSecretDelete(token, key),
    },
  }
}
