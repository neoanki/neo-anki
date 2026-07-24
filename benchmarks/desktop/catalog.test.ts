import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { initialBudgets, operationCatalog } from './catalog'

const projectFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('desktop benchmark operation catalog', () => {
  it('has unique IDs, reasons for exclusions, and budgets for every measured stage', () => {
    const ids = operationCatalog.map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const operation of operationCatalog) {
      if (operation.disposition !== 'measured') expect(operation.reason).toBeTruthy()
      for (const stage of operation.stages) {
        expect(initialBudgets.some((budget) => budget.operationId === operation.id && budget.stage === stage)).toBe(true)
      }
    }
  })

  it('classifies every core route', () => {
    const routes = [...projectFile('src/types.ts').matchAll(/export type Route = ([^\n]+)/g)]
      .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]))
      .filter((route) => !route.includes(':'))
    const catalogText = operationCatalog.map((operation) => `${operation.id} ${operation.label} ${(operation.variants || []).join(' ')}`).join('\n').toLowerCase()
    for (const route of routes) expect(catalogText).toContain(route)
  })

  it('classifies every desktop IPC channel as core, setup, OS-owned, or excluded extension work', () => {
    const source = projectFile('electron/main.ts')
    const channels = [...source.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((match) => match[1])
    const setup = new Set(['neo-anki:renderer-ready', 'neo-anki:workspace-usable', 'neo-anki:load-data', 'neo-anki:load-data-async', 'neo-anki:load-workspace-v4-editor-document', 'neo-anki:report-diagnostic', 'neo-anki:get-release-info'])
    const excludedPrefixes = ['neo-anki:extension-', 'neo-anki:list-extensions', 'neo-anki:list-marketplace', 'neo-anki:stage-marketplace', 'neo-anki:choose-extension', 'neo-anki:install-extension', 'neo-anki:discard-extension', 'neo-anki:set-extension', 'neo-anki:confirm-extension', 'neo-anki:rollback-extension', 'neo-anki:uninstall-extension', 'neo-anki:reload-for-extensions', 'neo-anki:claim-extension', 'neo-anki:stage-import', 'neo-anki:inspect-import', 'neo-anki:commit-workspace-v4-import']
    const catalogAreas = new Set(operationCatalog.map((operation) => operation.area))
    for (const channel of channels) {
      const classified = setup.has(channel)
        || excludedPrefixes.some((prefix) => channel.startsWith(prefix))
        || (channel.includes('sync') && catalogAreas.has('sync'))
        || (/(save-data|backup|reset-data|recovery|workspace|diagnostics|import-checkpoint|migration-recovery)/.test(channel) && catalogAreas.has('settings'))
      expect(classified, `Unclassified desktop IPC channel: ${channel}`).toBe(true)
    }
  })
})
