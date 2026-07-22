const tokens = new Map<string, string>()
const stagedMigrationSources = new Map<string, string>()
export const extensionCapabilityToken = (extensionId: string) => tokens.get(extensionId)
export const stageExtensionMigrationSource = async (extensionId: string, file: File) => {
  if (!window.neoAnkiDesktop?.stageImportSource) return undefined
  const token = await window.neoAnkiDesktop.stageImportSource(file)
  stagedMigrationSources.set(extensionId, token)
  return token
}
export const takeExtensionMigrationSource = (extensionId: string) => { const token = stagedMigrationSources.get(extensionId); stagedMigrationSources.delete(extensionId); return token }

export const prepareExtensionHost = async (extensionId: string) => {
  if (!window.neoAnkiDesktop || tokens.has(extensionId)) return
  tokens.set(extensionId, await window.neoAnkiDesktop.claimExtensionCapability(extensionId))
}
