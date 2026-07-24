import { migrateWorkspaceV3ToV4, type LegacyWorkspaceV3 } from './migrate-v3.js'
import { validateWorkspaceV4Invariants } from './invariants.js'
import { normalizeImportedWorkspaceDocument } from './import-export-normalization.js'
import type { WorkspaceDocumentV4, WorkspaceV4 } from './types.js'

const MAX_CLIENT_STATE_BYTES = 8 * 1024 * 1024

const validateClientState = (clientState: WorkspaceDocumentV4['clientState']) => {
  let bytes = Number.POSITIVE_INFINITY
  try { bytes = new TextEncoder().encode(JSON.stringify(clientState)).byteLength } catch { /* reported below */ }
  if (bytes > MAX_CLIENT_STATE_BYTES) throw new Error('Neo client state exceeds 8 MiB.')
  if (!clientState || typeof clientState !== 'object' || !clientState.settings || typeof clientState.settings !== 'object') throw new Error('Neo client state is invalid.')
  for (const key of ['goals', 'views', 'packs', 'packConflicts', 'trash'] as const) if (!Array.isArray(clientState[key])) throw new Error(`Neo client state ${key} must be an array.`)
  if (clientState.tombstones !== undefined && !Array.isArray(clientState.tombstones)) throw new Error('Neo client state tombstones must be an array.')
  return clientState
}

export const createWorkspaceDocumentV4 = (workspace: WorkspaceV4, clientState: WorkspaceDocumentV4['clientState']): WorkspaceDocumentV4 => ({
  format: 'neo-anki-workspace', schemaVersion: 4, workspace: validateWorkspaceV4Invariants(workspace), clientState: validateClientState(structuredClone(clientState)),
})

export const migrateWorkspaceDocumentV3ToV4 = (legacy: LegacyWorkspaceV3): WorkspaceDocumentV4 => createWorkspaceDocumentV4(
  migrateWorkspaceV3ToV4(legacy),
  { settings: structuredClone(legacy.settings), goals: structuredClone(legacy.goals || []), views: structuredClone(legacy.views || []), packs: structuredClone(legacy.packs || []), packConflicts: structuredClone(legacy.packConflicts || []), trash: structuredClone(legacy.trash || []) },
)

export const parseWorkspaceDocumentV4 = (input: unknown): WorkspaceDocumentV4 => {
  const candidate = normalizeImportedWorkspaceDocument(input) as Partial<WorkspaceDocumentV4>
  if (candidate?.format !== 'neo-anki-workspace' || candidate.schemaVersion !== 4 || !candidate.workspace || !candidate.clientState) throw new Error('This is not a Neo Anki Workspace v4 document.')
  const workspace = structuredClone(candidate.workspace)
  // Workspace v4 gained extension-owned records before public release; accept
  // early v4 previews without them and normalize to the authoritative shape.
  if (!Array.isArray(workspace.extensionRecords)) workspace.extensionRecords = []
  return createWorkspaceDocumentV4(workspace, candidate.clientState)
}
