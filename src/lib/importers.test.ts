import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { importFile } from './importers'

describe('unified import routing', () => {
  it('routes CSV and backup files', async () => {
    const csv = await importFile(new File(['prompt,answer\nQuestion,Answer'], 'cards.csv', { type: 'text/csv' }))
    expect(csv.source).toBe('csv')
    const backup = await importFile(new File([JSON.stringify(createSeedData())], 'backup.json', { type: 'application/json' }))
    expect(backup.source).toBe('backup')
  })
  it('rejects unknown extensions', async () => {
    await expect(importFile(new File(['x'], 'notes.txt'))).rejects.toThrow(/Choose an Anki/)
  })
})
