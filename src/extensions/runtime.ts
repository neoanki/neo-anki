import { ExtensionRegistry } from './registry'
import { imageOcclusionExtension } from './image-occlusion'
import { interoperabilityExtension } from './interoperability'
import { promptTypesExtension } from './prompts'
import { recoveryPoliciesExtension } from './recovery-policies'
import { tabSyncExtension } from './tab-sync'
import { workspaceExtension } from './workspace'
import { sharedPacksExtension } from './shared-packs'
import { insightsExtension } from './insights'

export const extensionRuntime = new ExtensionRegistry([
  promptTypesExtension,
  imageOcclusionExtension,
  interoperabilityExtension,
  recoveryPoliciesExtension,
  tabSyncExtension,
  workspaceExtension,
  sharedPacksExtension,
  insightsExtension,
])
