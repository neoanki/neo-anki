import { describe, expect, it, vi } from 'vitest'
import { applySandboxedUiAppearanceV1, createSandboxedUiClientV2, type SandboxedUiAppearanceV1, type SandboxedUiInit, type SandboxedUiMessageV2 } from '../../../packages/extension-sdk/src/index'

class FakeMessagePort {
  onmessage: ((event: MessageEvent<SandboxedUiMessageV2>) => void) | null = null
  messages: SandboxedUiMessageV2[] = []
  start() {}
  postMessage(message: SandboxedUiMessageV2) { this.messages.push(message) }
}

describe('SDK v2 sandbox frame sizing', () => {
  it('exposes a semantic foreground for primary-filled controls', () => {
    const appearance: SandboxedUiAppearanceV1 = {
      version: 1,
      colors: { background: '#272724', surface: '#30302d', surfaceStrong: '#373733', surfaceMuted: '#2b2b28', text: '#f2f1ec', textSoft: '#c1beb5', textFaint: '#aaa69c', border: '#474641', borderStrong: '#5b5952', primary: '#b7a2eb', primaryHover: '#c0adeb', primarySoft: '#443b59', onPrimary: '#1b1724', success: '#78c9ad', successSoft: '#263e36', warning: '#e2b46f', warningSoft: '#453722', danger: '#ee9595', dangerSoft: '#492d2d', focus: '#b7a2eb' },
      typography: { fontFamily: 'system-ui', fontSize: '16px', lineHeight: '1.5' },
      spacing: { unit: '8px', density: 'comfortable' },
      radii: { small: '6px', medium: '9px', large: '12px' },
      reducedMotion: false,
    }
    applySandboxedUiAppearanceV1(appearance)
    expect(document.documentElement.style.getPropertyValue('--neo-on-primary')).toBe('#1b1724')
  })

  it('reports intrinsic body height and can shrink below the current iframe viewport', async () => {
    const observed: Element[] = []
    const callbacks: ResizeObserverCallback[] = []
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
      observe(element: Element) { observed.push(element) }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 4_200 })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 9_000 })
    const port = new FakeMessagePort()
    const pending = createSandboxedUiClientV2()
    const init: SandboxedUiInit = { type: 'neo-anki:init-ui-v2', extensionId: 'org.neoanki.fixture', contributionId: 'settings', locale: 'en', theme: 'light', dto: {} }
    const event = new MessageEvent('message', { data: init })
    Object.defineProperty(event, 'ports', { value: [port] })
    globalThis.dispatchEvent(event)
    const client = await pending

    expect(observed).toEqual([document.body])
    callbacks[0]!([], {} as ResizeObserver)
    expect(port.messages).toContainEqual({ protocol: 2, type: 'event', name: 'resize', payload: { height: 4_200 } })

    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 1_200 })
    client.reportHeight()
    expect(port.messages.at(-1)).toEqual({ protocol: 2, type: 'event', name: 'resize', payload: { height: 1_200 } })
    vi.unstubAllGlobals()
  })
})
