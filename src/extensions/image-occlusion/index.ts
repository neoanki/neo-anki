import type { NeoAnkiExtension } from '../sdk'
import { ImageOcclusionEditor } from './ImageOcclusionEditor'

export const imageOcclusionExtension: NeoAnkiExtension = {
  manifest: {
    id: 'neo-anki.image-occlusion',
    name: 'Image Occlusion',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'Neo Anki contributors',
    permissions: ['prompts:contribute', 'ui:create-panels'],
  },
  promptTypes: [{
    id: 'image-occlusion',
    label: 'Image occlusion',
    createCards: (input) => (input.occlusions.length ? input.occlusions : [undefined]).map((occlusion) => ({ promptType: 'image-occlusion', estimatedSeconds: 18, occlusionId: occlusion?.id })),
    render: (item, card) => ({
      prompt: item.prompt || 'Name the hidden part.',
      answer: item.occlusions.find((rect) => rect.id === card.occlusionId)?.label || item.answer,
      context: item.context,
      typed: false,
      mediaId: item.mediaIds[0],
      occlusionId: card.occlusionId,
      citations: item.citations,
    }),
  }],
  creationPanels: [{ id: 'image-occlusion-editor', component: ImageOcclusionEditor }],
}

export { normalizeRect, rectFromPoints, rectStyle } from './geometry'
