import { useEffect, useMemo, useRef, useState } from 'react'

const documentFor = (html: string, css: string, token: string, theme: 'light' | 'dark') => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: neoanki-media:; media-src data: blob: neoanki-media:; font-src data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<style>
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; background: transparent; color: ${theme === 'dark' ? '#f4f1fb' : '#111827'}; }
body { overflow-wrap: anywhere; font: 400 1rem/1.55 system-ui, sans-serif; text-align: center; }
img, video, svg { max-width: 100%; height: auto; }
audio { width: min(100%, 32rem); }
button, input, select, textarea, summary { min-height: 44px; font: inherit; }
a { color: #6d4ed4; }
:focus-visible { outline: 3px solid #7c3aed; outline-offset: 3px; }
.cloze { color: #6d4ed4; font-weight: 700; }
.media-missing { display: inline-block; padding: .5rem .75rem; border: 1px solid #b42318; border-radius: .5rem; color: #b42318; }
@media (prefers-color-scheme: dark) { a, .cloze { color: #b9a6ff; } .media-missing { color: #ffb4ab; border-color: #ffb4ab; } }
${css}
</style></head><body data-neoanki-token="${token.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" class="card ${theme === 'dark' ? 'nightMode night_mode' : ''}"><main>${html}</main>
<script src="./card-frame-resize.js"></script>
</body></html>`

export const SandboxedCardFrame = ({ html, css, title, theme }: { html: string; css: string; title: string; theme: 'light' | 'dark' }) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const token = useMemo(() => `${crypto.randomUUID()}:${html.length}:${css.length}`, [html, css])
  const [measured, setMeasured] = useState({ token: '', height: 120 })
  const height = measured.token === token ? measured.height : 120
  const srcDoc = useMemo(() => documentFor(html, css, token, theme), [html, css, token, theme])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.token !== token) return
      const next = Number(event.data.neoAnkiCardHeight)
      if (Number.isFinite(next)) setMeasured({ token, height: Math.max(80, Math.min(1600, Math.ceil(next))) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [token])

  return <iframe ref={frame} className="sandboxed-card-frame" sandbox="allow-scripts" srcDoc={srcDoc} title={title} style={{ height }} />
}
