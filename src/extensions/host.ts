const tokens = new Map<string, string>()
export const extensionCapabilityToken = (extensionId: string) => tokens.get(extensionId)

export const prepareExtensionHost = async (extensionId: string) => {
  if (!window.neoAnkiDesktop || tokens.has(extensionId)) return
  tokens.set(extensionId, await window.neoAnkiDesktop.claimExtensionCapability(extensionId))
}
