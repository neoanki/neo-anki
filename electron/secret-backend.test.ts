import { describe, expect, it } from 'vitest'
import { secureSecretStorageAvailable } from './secret-backend.js'

describe('secureSecretStorageAvailable', () => {
  it('accepts operating-system credential stores', () => {
    expect(secureSecretStorageAvailable('darwin', true)).toBe(true)
    expect(secureSecretStorageAvailable('win32', true)).toBe(true)
    expect(secureSecretStorageAvailable('linux', true, 'gnome_libsecret')).toBe(true)
    expect(secureSecretStorageAvailable('linux', true, 'kwallet6')).toBe(true)
  })

  it('rejects unavailable and hardcoded-password Linux backends', () => {
    expect(secureSecretStorageAvailable('linux', false, 'unknown')).toBe(false)
    expect(secureSecretStorageAvailable('linux', true, 'unknown')).toBe(false)
    expect(secureSecretStorageAvailable('linux', true, 'basic_text')).toBe(false)
  })
})
