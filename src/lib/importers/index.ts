import type { ImportSummary } from '../../types'
import { parseBackup } from '../storage'
import { importAnkiPackage } from './anki'
import { importCsvText } from './csv'

export const importFile = async (file: File): Promise<ImportSummary> => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.apkg') || name.endsWith('.colpkg')) return importAnkiPackage(await file.arrayBuffer())
  if (name.endsWith('.csv')) return importCsvText(await file.text())
  if (name.endsWith('.json')) {
    const data = await parseBackup(file)
    return { source: 'backup', items: data.items, cards: data.cards, assets: data.assets, warnings: [] }
  }
  throw new Error('Choose an Anki .apkg/.colpkg, Neo Anki .json backup, or .csv file.')
}
