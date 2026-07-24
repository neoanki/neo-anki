import { validateWorkspaceV4Invariants } from './invariants.js'
import type { WorkspaceEntity, WorkspaceEntityKind, WorkspacePatchV2, WorkspaceV4 } from './types.js'

const MAX_PATCH_OPERATIONS = 10_000
const MAX_PATCH_BYTES = 8 * 1024 * 1024
const EXTENSION_MUTABLE_KINDS = new Set<WorkspaceEntityKind>(['noteType', 'field', 'template', 'deck', 'preset', 'note', 'card', 'extensionRecord'])

const collections: Record<WorkspaceEntityKind, keyof WorkspaceV4> = {
  profile: 'profiles', noteType: 'noteTypes', field: 'fields', template: 'templates', deck: 'decks', preset: 'presets', note: 'notes', card: 'cards', review: 'reviews', media: 'media', extensionRecord: 'extensionRecords', sourceEnvelope: 'sourceEnvelopes',
}

export const applyWorkspacePatchV2 = (workspace: WorkspaceV4, patch: WorkspacePatchV2): WorkspaceV4 => {
  if (patch.version !== 2) throw new Error('Unsupported workspace patch version.')
  if (!patch.idempotencyKey.trim()) throw new Error('A patch idempotency key is required.')
  if (patch.expectedWorkspaceRevision !== workspace.revision) throw new Error('Workspace revision conflict.')
  if (patch.operations.length > MAX_PATCH_OPERATIONS) throw new Error(`A patch may contain at most ${MAX_PATCH_OPERATIONS} operations.`)
  if (new TextEncoder().encode(JSON.stringify(patch)).byteLength > MAX_PATCH_BYTES) throw new Error('Workspace patch exceeds 8 MiB.')
  const extensionOwner = patch.owner.type === 'extension' ? patch.owner : null
  const extensionNamespace = extensionOwner ? `extension:${extensionOwner.extensionId}:` : null
  if (extensionOwner) {
    if (!extensionOwner.extensionId.trim()) throw new Error('Extension patch owner is invalid.')
    if (!extensionOwner.scopes.includes('content:patch-own')) throw new Error('Extension patch is missing the content:patch-own scope.')
  }
  // Workspace entities are immutable at the API boundary. Clone only a
  // collection when the patch first touches it; cloning a 100k-review graph for
  // a one-field template edit dominated desktop persistence.
  const next = { ...workspace }
  const clonedCollections = new Set<keyof WorkspaceV4>()
  for (const operation of patch.operations) {
    if (extensionNamespace) {
      if (!EXTENSION_MUTABLE_KINDS.has(operation.kind)) throw new Error(`Extensions cannot mutate ${operation.kind} entities through content:patch-own.`)
      if (!operation.id.startsWith(extensionNamespace) || operation.id.length === extensionNamespace.length) throw new Error(`Extension entity ${operation.id} is outside the owner's reserved namespace.`)
      if (operation.value && operation.value.id !== operation.id) throw new Error(`Extension entity ${operation.id} has a mismatched value id.`)
      if (operation.kind === 'extensionRecord' && operation.value && (operation.value as { extensionId?: unknown }).extensionId !== extensionOwner!.extensionId) throw new Error('Extension record ownership does not match the patch owner.')
    }
    const key = collections[operation.kind]
    if (!clonedCollections.has(key)) {
      ;(next[key] as unknown) = [...(workspace[key] as unknown as WorkspaceEntity[])]
      clonedCollections.add(key)
    }
    const values = next[key] as unknown as WorkspaceEntity[]
    const index = values.findIndex((value) => value.id === operation.id)
    if (operation.op === 'create') {
      if (index >= 0) throw new Error(`${operation.kind} ${operation.id} already exists.`)
      if (!operation.value || operation.value.id !== operation.id) throw new Error(`Create operation ${operation.id} has no matching value.`)
      values.push(structuredClone(operation.value))
    } else if (operation.op === 'update') {
      if (index < 0) throw new Error(`${operation.kind} ${operation.id} does not exist.`)
      if (operation.expectedRevision !== values[index].revision) throw new Error(`${operation.kind} ${operation.id} revision conflict.`)
      if (!operation.value || operation.value.id !== operation.id || operation.value.revision !== values[index].revision + 1) throw new Error(`Update ${operation.id} must advance its revision exactly once.`)
      values[index] = structuredClone(operation.value)
    } else {
      if (operation.kind === 'review') throw new Error('Review events are append-only; append a reversal event instead.')
      if (index < 0) throw new Error(`${operation.kind} ${operation.id} does not exist.`)
      if (operation.expectedRevision !== values[index].revision) throw new Error(`${operation.kind} ${operation.id} revision conflict.`)
      values.splice(index, 1)
    }
  }
  next.revision += 1
  next.updatedAt = new Date().toISOString()
  return validateWorkspaceV4Invariants(next)
}
