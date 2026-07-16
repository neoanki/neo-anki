import { describe, expect, it } from 'vitest'
import { exportCsv, importCsvText } from './importers/csv'

describe('CSV portability', () => {
  it('imports quoted multiline content and round-trips variants', () => {
    const imported = importCsvText('prompt,answer,context,collection,tags,source,variants\n"Why, exactly?","Line 1\nLine 2",ctx,Science,a|b,https://example.com,forward|typed')
    expect(imported.items[0].prompt).toBe('Why, exactly?')
    expect(imported.cards.map((card) => card.variant)).toEqual(['forward', 'typed'])
    const again = importCsvText(exportCsv(imported.items, imported.cards))
    expect(again.items[0].answer).toBe('Line 1\nLine 2')
  })
  it('rejects missing required columns and warns about incomplete rows', () => {
    expect(() => importCsvText('foo,bar\na,b')).toThrow(/prompt and answer/)
    expect(importCsvText('prompt,answer\nvalid,yes\nmissing,').warnings).toHaveLength(1)
  })
})
