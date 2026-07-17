import { describe, expect, it } from 'vitest'
import { addDays, dayKey, endOfDay, isToday, startOfDay } from './date'

describe(`local calendar boundaries (${process.env.TZ || 'system time zone'})`, () => {
  it('builds date keys from the local calendar rather than UTC midnight', () => {
    const local = new Date(2026, 6, 17, 0, 15)
    expect(dayKey(local)).toBe('2026-07-17')
  })

  it('preserves local wall-clock time when moving across a calendar day', () => {
    const before = new Date(2026, 2, 7, 12, 30)
    const after = addDays(before, 1)
    expect([after.getFullYear(), after.getMonth(), after.getDate(), after.getHours(), after.getMinutes()]).toEqual([2026, 2, 8, 12, 30])
  })

  it('uses 23- and 25-hour local days at New York DST boundaries', () => {
    if (process.env.TZ !== 'America/New_York') return
    const spring = new Date(2026, 2, 8, 12)
    const autumn = new Date(2026, 10, 1, 12)
    const hours = (value: Date) => (endOfDay(value).getTime() - startOfDay(value).getTime() + 1) / 3_600_000
    expect(hours(spring)).toBe(23)
    expect(hours(autumn)).toBe(25)
  })

  it('compares instants using the current local day', () => {
    const now = new Date(2026, 6, 17, 23, 30)
    expect(isToday(new Date(2026, 6, 17, 0, 1).toISOString(), now)).toBe(true)
    expect(isToday(new Date(2026, 6, 16, 23, 59).toISOString(), now)).toBe(false)
  })
})
