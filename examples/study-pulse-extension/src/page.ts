import { createSandboxedUiClient } from '@neo-anki/extension-sdk'

void createSandboxedUiClient().then(async (client) => {
  const init = client.init
  const summary = (init.dto as { summary?: { notes?: number; cards?: number; dueToday?: number } }).summary || {}
  const probe = await client.call<{ blocked: boolean }>('command', { commandId: 'isolation-probe' }).catch(() => ({ blocked: false }))
  document.documentElement.dataset.theme = init.theme
  document.body.innerHTML = `<main><p class="eyebrow">Example extension · isolated iframe</p><h1>Study Pulse</h1><p>This page receives a minimal summary DTO. It cannot read the renderer DOM, CSS, workspace, credentials, or network.</p><p role="status">Worker network: <strong>${probe.blocked ? 'blocked' : 'isolation failed'}</strong></p><dl><div><dt>Notes</dt><dd>${Number(summary.notes || 0).toLocaleString()}</dd></div><div><dt>Cards</dt><dd>${Number(summary.cards || 0).toLocaleString()}</dd></div><div><dt>Due today</dt><dd>${Number(summary.dueToday || 0).toLocaleString()}</dd></div></dl></main>`
  const style = document.createElement('style')
  style.textContent = `:root{color-scheme:light dark;font:16px/1.6 system-ui,sans-serif}body{margin:0;color:#0f172a;background:#fff}main{padding:24px}.eyebrow{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#2563eb}h1{margin:.25rem 0}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:12px}dl div{padding:16px;border:1px solid #cbd5e1;border-radius:12px}dt{color:#475569}dd{margin:4px 0 0;font-size:1.6rem;font-weight:700}:root[data-theme=dark] body{color:#f8fafc;background:#0f172a}:root[data-theme=dark] dl div{border-color:#475569}:root[data-theme=dark] dt{color:#cbd5e1}`
  document.head.append(style)
})
