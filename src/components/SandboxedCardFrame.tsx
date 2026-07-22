import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'

const sanitizeCardHtml = (html: string) => {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['script', 'meta', 'base', 'link', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc', 'action', 'formaction'],
    ALLOWED_URI_REGEXP: /^(?:(?:data|blob|neoanki-media):|#)/i,
  })
  fragment.querySelectorAll<HTMLElement>('[href], [xlink\\:href]').forEach((element) => {
    for (const name of ['href', 'xlink:href']) {
      const value = element.getAttribute(name)
      if (value !== null && !value.trim().startsWith('#')) element.removeAttribute(name)
    }
  })
  fragment.querySelectorAll<HTMLAudioElement>('audio').forEach((audio) => {
    audio.controls = true
    audio.preload = 'metadata'
    const wrapper = audio.parentElement
    if (wrapper?.tagName === 'BUTTON') {
      audio.remove()
      wrapper.replaceWith(audio)
    }
  })
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

const safeCss = (css: string) => css.replace(/<\/style/gi, '<\\/style')

const cardScript = `(() => {
  'use strict'
  const token = document.body.dataset.neoankiToken || ''
  const send = () => parent.postMessage({ neoAnkiCardHeight: document.documentElement.scrollHeight, token }, '*')
  const report = (status, message = '') => parent.postMessage({ neoAnkiCardMedia: { status, message }, token }, '*')
  new ResizeObserver(send).observe(document.body)
  addEventListener('load', send, { once: true })
  const audio = Array.from(document.querySelectorAll('audio'))
  for (const element of audio) {
    element.addEventListener('playing', () => report('playing'))
    element.addEventListener('error', () => {
      const messages = ['', 'Playback was interrupted.', 'The audio file could not be loaded.', 'The audio file could not be decoded.', 'This audio format is not supported.']
      report('error', messages[element.error?.code || 0] || 'The audio file could not be played.')
    })
  }
  if (document.body.dataset.neoankiAutoplay === 'true' && audio[0]) {
    const started = audio[0].play()
    if (started) started.catch((error) => report('error', error?.name === 'NotAllowedError' ? 'Automatic playback was blocked. Use the audio Play control.' : 'The audio file could not be played.'))
  }
  send()
})()`

const documentFor = (html: string, css: string, token: string, theme: 'light' | 'dark', autoPlayAudio: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: neoanki-media:; media-src data: blob: neoanki-media:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-I5nKynGL7+NgE4xb9wvF3PAdBcXpOCBn5kMStqk5YPE='; connect-src 'none'; form-action 'none'; base-uri 'none'">
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
${safeCss(css)}
</style></head><body data-neoanki-token="${token.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" data-neoanki-autoplay="${autoPlayAudio}" class="card ${theme === 'dark' ? 'nightMode night_mode' : ''}"><main>${sanitizeCardHtml(html)}</main>
<script>${cardScript}</script>
</body></html>`

export const SandboxedCardFrame = ({ html, css, title, theme, autoPlayAudio = false, onMediaStatus }: { html: string; css: string; title: string; theme: 'light' | 'dark'; autoPlayAudio?: boolean; onMediaStatus?: (status: 'playing' | 'error', message: string) => void }) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const token = useMemo(() => `${crypto.randomUUID()}:${html.length}:${css.length}`, [html, css])
  const [measured, setMeasured] = useState({ token: '', height: 120 })
  const height = measured.token === token ? measured.height : 120
  const srcDoc = useMemo(() => documentFor(html, css, token, theme, autoPlayAudio), [html, css, token, theme, autoPlayAudio])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.token !== token) return
      const media = event.data.neoAnkiCardMedia
      if (media && (media.status === 'playing' || media.status === 'error')) onMediaStatus?.(media.status, typeof media.message === 'string' ? media.message : '')
      const next = Number(event.data.neoAnkiCardHeight)
      if (Number.isFinite(next)) setMeasured({ token, height: Math.max(80, Math.min(1600, Math.ceil(next))) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onMediaStatus, token])

  return <iframe ref={frame} className="sandboxed-card-frame" sandbox="allow-scripts" allow="autoplay" srcDoc={srcDoc} title={title} style={{ height }} />
}
