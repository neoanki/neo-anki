import { useEffect, useRef } from 'react'
import type { ExtensionUiContributionV2 } from './registry.js'
import { executeExtensionCommandV2 } from './registry.js'
import { createSandboxedExtensionUiV2 } from './runtime.js'

export const ExtensionUiFrameV2 = ({ contribution, dto, reloadKey = '' }: { contribution: ExtensionUiContributionV2; dto: unknown; reloadKey?: string }) => {
  const container = useRef<HTMLDivElement>(null)
  const dtoRef = useRef(dto)
  const runtimeRef = useRef<ReturnType<typeof createSandboxedExtensionUiV2> | null>(null)
  useEffect(() => {
    if (!container.current) return
    const runtime = createSandboxedExtensionUiV2(contribution.manifest, contribution.id, contribution.url, { locale: navigator.language, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', dto: dtoRef.current }, async (name, payload) => {
      if (name !== 'command') throw new Error(`Unsupported extension UI host call ${name}.`)
      const command = payload as { commandId?: unknown; payload?: unknown }
      if (typeof command?.commandId !== 'string') throw new Error('Extension UI command is invalid.')
      return executeExtensionCommandV2(contribution.extensionId, command.commandId, command.payload)
    })
    runtimeRef.current = runtime
    container.current.replaceChildren(runtime.iframe)
    return () => { runtimeRef.current = null; runtime.close() }
  }, [contribution, reloadKey])
  useEffect(() => { dtoRef.current = dto; runtimeRef.current?.post('dto', dto) }, [dto])
  return <div ref={container} className={`extension-ui-container-v2 extension-ui-container-v2-${contribution.surface}`} aria-label={`${contribution.label} extension panel`} />
}
