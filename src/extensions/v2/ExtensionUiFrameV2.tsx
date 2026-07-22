import { AlertTriangle, Bug, RefreshCw, ShieldOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SandboxedUiAppearanceV1 } from '../../../packages/extension-sdk/src/index.js'
import type { ExtensionUiContributionV2 } from './registry.js'
import { executeExtensionCommandV2, markExtensionUiReadyV2, rollbackPendingExtensionActivationV2 } from './registry.js'
import { createSandboxedExtensionUiV2 } from './runtime.js'
import { extensionCapabilityToken, stageExtensionMigrationSource } from '../host.js'

const cssValue = (styles: CSSStyleDeclaration, name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
const supportsHostArchiveInspection = (contribution: ExtensionUiContributionV2) => {
  if (contribution.extensionId !== 'org.neoanki.interoperability') return false
  const [major = 0, minor = 0, patch = 0] = contribution.manifest.version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return major > 2 || major === 2 && (minor > 0 || minor === 0 && patch >= 7)
}

const currentAppearance = (): { theme: 'light' | 'dark'; appearance: SandboxedUiAppearanceV1 } => {
  const styles = getComputedStyle(document.documentElement)
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const primary = cssValue(styles, '--primary', theme === 'dark' ? '#a98de4' : '#6246a5')
  return {
    theme,
    appearance: {
      version: 1,
      colors: {
        background: cssValue(styles, '--bg', theme === 'dark' ? '#1b1a18' : '#f4f1ea'),
        surface: cssValue(styles, '--surface', theme === 'dark' ? '#242320' : '#fbfaf7'),
        surfaceStrong: cssValue(styles, '--surface-strong', theme === 'dark' ? '#2d2b27' : '#ffffff'),
        surfaceMuted: cssValue(styles, '--surface-muted', theme === 'dark' ? '#33312d' : '#eeebe3'),
        text: cssValue(styles, '--text', theme === 'dark' ? '#f1eee8' : '#26241f'),
        textSoft: cssValue(styles, '--text-soft', theme === 'dark' ? '#b9b4aa' : '#69655d'),
        textFaint: cssValue(styles, '--text-faint', theme === 'dark' ? '#969086' : '#8a857b'),
        border: cssValue(styles, '--border', theme === 'dark' ? '#403d37' : '#ddd8ce'),
        borderStrong: cssValue(styles, '--border-strong', theme === 'dark' ? '#555047' : '#c9c2b6'),
        primary,
        primaryHover: cssValue(styles, '--primary-hover', primary),
        primarySoft: cssValue(styles, '--primary-soft', theme === 'dark' ? '#3b314f' : '#ece6f8'),
        onPrimary: theme === 'dark' ? '#1b1724' : '#ffffff',
        success: cssValue(styles, '--green', theme === 'dark' ? '#78c9ad' : '#26755f'),
        successSoft: cssValue(styles, '--green-soft', theme === 'dark' ? '#263e36' : '#e2f2ec'),
        warning: cssValue(styles, '--amber', theme === 'dark' ? '#e2b46f' : '#9a631b'),
        warningSoft: cssValue(styles, '--amber-soft', theme === 'dark' ? '#453722' : '#f7ecd8'),
        danger: cssValue(styles, '--red', theme === 'dark' ? '#ee9595' : '#a84343'),
        dangerSoft: cssValue(styles, '--red-soft', theme === 'dark' ? '#492d2d' : '#fae8e6'),
        focus: primary,
      },
      typography: { fontFamily: styles.fontFamily || 'Inter, system-ui, sans-serif', fontSize: styles.fontSize || '16px', lineHeight: '1.5' },
      spacing: { unit: '8px', density: 'comfortable' },
      radii: { small: '6px', medium: '9px', large: '12px' },
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    },
  }
}

type FrameState = 'loading' | 'ready' | 'error'

export const ExtensionUiFrameV2 = ({ contribution, dto, reloadKey = '', onResult }: { contribution: ExtensionUiContributionV2; dto: unknown; reloadKey?: string; onResult?: (value: unknown) => void }) => {
  const container = useRef<HTMLDivElement>(null)
  const dtoRef = useRef(dto)
  const onResultRef = useRef(onResult)
  const runtimeRef = useRef<ReturnType<typeof createSandboxedExtensionUiV2> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<FrameState>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!container.current) return
    const appearance = currentAppearance()
    const timeout = window.setTimeout(() => {
      setState('error')
      setError('This extension did not become ready. It may be incompatible or need to be reloaded.')
      void rollbackPendingExtensionActivationV2(contribution.extensionId, `${contribution.id} did not become ready.`)
    }, 8_000)
    try {
      const runtime = createSandboxedExtensionUiV2(contribution.manifest, contribution.id, contribution.url, { locale: navigator.language, ...appearance, dto: dtoRef.current }, async (name, payload) => {
        if (name === 'command') {
          const command = payload as { commandId?: unknown; payload?: unknown }
          if (typeof command?.commandId !== 'string') throw new Error('Extension UI command is invalid.')
          let commandPayload = command.payload
          if (command.commandId === 'interop.inspect' && command.payload instanceof File && supportsHostArchiveInspection(contribution)) {
            const sourceFileToken = await stageExtensionMigrationSource(contribution.extensionId, command.payload)
            const bridge = window.neoAnkiDesktop
            const capabilityToken = extensionCapabilityToken(contribution.extensionId)
            if (sourceFileToken && bridge?.inspectImportSource && capabilityToken && /\.(?:apkg|colpkg)$/i.test(command.payload.name)) {
              commandPayload = { filename: command.payload.name, inspection: await bridge.inspectImportSource(capabilityToken, sourceFileToken) }
            }
          }
          const result = await executeExtensionCommandV2(contribution.extensionId, command.commandId, commandPayload)
          onResultRef.current?.(result)
          return result
        }
        const bridge = window.neoAnkiDesktop
        const token = extensionCapabilityToken(contribution.extensionId)
        if (!bridge || !token) throw new Error('This extension action requires Neo Anki desktop.')
        if (name === 'files.save') {
          if (!bridge.extensionSaveFileV2) throw new Error('This Neo Anki version cannot save extension files. Update Neo Anki and try again.')
          return bridge.extensionSaveFileV2(token, payload as { filename: string; mimeType: string; text?: string; bytes?: Uint8Array })
        }
        if (name === 'ui.openExternal') {
          const url = (payload as { url?: unknown })?.url
          if (typeof url !== 'string') throw new Error('The extension provided an invalid external link.')
          if (!bridge.extensionOpenExternalV2) throw new Error('This Neo Anki version cannot open extension links. Update Neo Anki and try again.')
          await bridge.extensionOpenExternalV2(token, url)
          return undefined
        }
        throw new Error(`Unsupported extension UI host call ${name}.`)
      }, (event) => {
        if (event.type === 'ready') { window.clearTimeout(timeout); setState('ready'); void markExtensionUiReadyV2(contribution.extensionId, contribution.id) }
        else if (event.type === 'error') { window.clearTimeout(timeout); setState('error'); setError(event.message); void rollbackPendingExtensionActivationV2(contribution.extensionId, `${contribution.id} failed to start: ${event.message}`) }
        else if (runtimeRef.current) runtimeRef.current.iframe.style.height = `${event.height}px`
      })
      runtimeRef.current = runtime
      container.current.replaceChildren(runtime.iframe)
    } catch (reason) {
      window.clearTimeout(timeout)
      queueMicrotask(() => {
        setState('error')
        const message = reason instanceof Error ? reason.message : 'The extension interface could not be opened.'
        setError(message)
        void rollbackPendingExtensionActivationV2(contribution.extensionId, `${contribution.id} could not be opened: ${message}`)
      })
    }
    const observer = new MutationObserver(() => {
      const next = currentAppearance()
      runtimeRef.current?.post('appearance', next.appearance)
      runtimeRef.current?.post('theme', next.theme)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { window.clearTimeout(timeout); observer.disconnect(); runtimeRef.current?.close(); runtimeRef.current = null }
  }, [attempt, contribution, reloadKey])

  useEffect(() => { dtoRef.current = dto; runtimeRef.current?.post('dto', dto) }, [dto])
  useEffect(() => { onResultRef.current = onResult }, [onResult])

  const disable = async () => {
    if (!window.neoAnkiDesktop || !window.confirm(`Disable ${contribution.manifest.name}? You can enable it again from Extensions.`)) return
    await window.neoAnkiDesktop.setExtensionEnabled(contribution.extensionId, false)
    await window.neoAnkiDesktop.reloadForExtensions()
  }
  const diagnostics = async () => {
    if (window.neoAnkiDesktop) await window.neoAnkiDesktop.exportDiagnostics()
    else await navigator.clipboard?.writeText(`${contribution.extensionId}:${contribution.id}\n${error}`).catch(() => undefined)
  }

  return <section className={`extension-ui-host-v2 extension-ui-host-v2-${contribution.surface}`} aria-label={`${contribution.label} extension panel`} aria-busy={state === 'loading'}>
    <div ref={container} className={`extension-ui-container-v2 extension-ui-container-v2-${contribution.surface}`} />
    {state === 'loading' && <div className="extension-frame-state" role="status"><RefreshCw className="spin" size={18}/><span>Loading {contribution.label}…</span></div>}
    {state === 'error' && <div className="extension-frame-state error" role="alert">
      <AlertTriangle size={20}/><div><strong>{contribution.label} could not open</strong><p>{error}</p></div>
      <div className="button-row"><button className="secondary-button compact" onClick={() => { setState('loading'); setError(''); setAttempt((value) => value + 1) }}><RefreshCw size={15}/> Retry</button><button className="secondary-button compact" onClick={() => void diagnostics()}><Bug size={15}/> {window.neoAnkiDesktop ? 'Export diagnostics' : 'Copy diagnostics'}</button>{window.neoAnkiDesktop && <button className="text-button danger" onClick={() => void disable()}><ShieldOff size={15}/> Disable extension</button>}</div>
    </div>}
  </section>
}
