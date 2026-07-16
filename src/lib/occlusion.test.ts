import { describe, expect, it } from 'vitest'
import { normalizeRect, rectFromPoints, rectStyle } from './occlusion'

describe('image occlusion geometry', () => {
  it('normalizes reverse drag direction and clamps bounds', () => {
    const rect = rectFromPoints({ x: 80, y: 70 }, { x: 20, y: 10 })
    expect(rect).toMatchObject({ x: 20, y: 10, width: 60, height: 60 })
    expect(normalizeRect({ x: 99, y: -5, width: 40, height: 0 })).toMatchObject({ x: 99, y: 0, width: 1, height: 2 })
    expect(rectStyle(rect)).toEqual({ left: '20%', top: '10%', width: '60%', height: '60%' })
  })
})
