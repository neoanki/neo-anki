import type { PackManifest, PackPatch } from '../../types'
import { applyPackPatch, installPack, resolvePackConflict } from './service'
import type { NeoAnkiExtension } from '../sdk'
import { PacksPanel } from './PacksPanel'

export const sharedPacksExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.shared-packs',
    name: 'Shared Packs',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['content:transactions', 'ui:workspace-panels'],
  },
  commands: [
    { id: 'packs.install', run: (context, payload) => context.replaceData(installPack(context.data, payload as PackManifest).data) },
    { id: 'packs.patch', run: (context, payload) => context.replaceData(applyPackPatch(context.data, payload as PackPatch).data) },
    { id: 'packs.resolve', run: (context, payload) => { const value = payload as { id: string; resolution: 'local' | 'upstream' }; context.replaceData(resolvePackConflict(context.data, value.id, value.resolution)) } },
  ],
  workspacePanels: [{ id: 'packs', label: 'Shared packs', component: PacksPanel }],
}
