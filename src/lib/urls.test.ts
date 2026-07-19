import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from './urls'

describe('safeExternalUrl', () => {
  it('normalizes web links and rejects ambiguous or executable inputs', () => {
    expect(safeExternalUrl('https://example.com/a b')).toBe('https://example.com/a%20b')
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('not a url')).toBeNull()
    expect(safeExternalUrl(undefined)).toBeNull()
  })
})
