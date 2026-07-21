import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

const values = new Map<string, string>()
const memoryStorage: Storage = {
  get length() { return values.size },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key) },
  setItem: (key, value) => { values.set(key, String(value)) },
}
if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
  })
  Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true })
  document.documentElement.lang = 'en'
  document.title = 'Neo Anki'
}
