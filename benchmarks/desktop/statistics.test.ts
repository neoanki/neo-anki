import { describe, expect, it } from 'vitest'
import { pairedRegression, summarizeDistribution, summarizeSamples } from './statistics'
import type { BenchmarkSample } from './types'

describe('desktop benchmark statistics', () => {
  it('computes interpolated percentiles and median absolute deviation', () => {
    expect(summarizeDistribution([1, 2, 3, 4, 100])).toEqual({
      count: 5,
      median: 3,
      p95: 80.79999999999998,
      max: 100,
      mad: 1,
    })
  })

  it('requires ratio, absolute, and noise guards before reporting regression', () => {
    const base = summarizeDistribution([95, 100, 105, 100, 100])
    expect(pairedRegression(base, summarizeDistribution([116, 120, 124, 120, 120])).regressed).toBe(true)
    expect(pairedRegression(base, summarizeDistribution([108, 109, 110, 109, 109])).regressed).toBe(false)
  })

  it('groups samples by operation and dataset', () => {
    const sample = (settledMs: number): BenchmarkSample => ({
      operationId: 'navigation.routes.warm',
      iteration: settledMs,
      dataset: 'small',
      tier: 'full',
      settledMs,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      longestTaskMs: 0,
      frameGapP95Ms: 16,
      worstFrameGapMs: 20,
      success: true,
      measuredAt: '2026-07-24T00:00:00.000Z',
    })
    const result = summarizeSamples([sample(10), sample(20), sample(30)])
    expect(result).toHaveLength(1)
    expect(result[0].settled?.median).toBe(20)
    expect(result[0].failures).toBe(0)
  })
})
