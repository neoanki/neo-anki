import type { BenchmarkSample, DistributionSummary, OperationSummary } from './types'

const sorted = (values: number[]) => [...values].filter(Number.isFinite).sort((left, right) => left - right)
const quantile = (values: number[], fraction: number) => {
  const ordered = sorted(values)
  if (!ordered.length) return 0
  const position = (ordered.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return ordered[lower]
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}

export const summarizeDistribution = (values: number[]): DistributionSummary => {
  const ordered = sorted(values)
  const median = quantile(ordered, 0.5)
  const deviations = ordered.map((value) => Math.abs(value - median))
  return {
    count: ordered.length,
    median,
    p95: quantile(ordered, 0.95),
    max: ordered.at(-1) || 0,
    mad: quantile(deviations, 0.5),
  }
}

const present = (values: Array<number | undefined>) => values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

export const summarizeSamples = (samples: BenchmarkSample[]): OperationSummary[] => {
  const groups = new Map<string, BenchmarkSample[]>()
  for (const sample of samples) {
    const key = `${sample.operationId}\u0000${sample.dataset}`
    groups.set(key, [...(groups.get(key) || []), sample])
  }
  return [...groups.values()].map((group) => {
    const first = group[0]
    const feedback = present(group.map((sample) => sample.feedbackMs))
    const settled = present(group.map((sample) => sample.settledMs))
    const durable = present(group.map((sample) => sample.durableMs))
    const lifecycle = present(group.map((sample) => sample.lifecycleMs))
    return {
      operationId: first.operationId,
      dataset: first.dataset,
      feedback: feedback.length ? summarizeDistribution(feedback) : undefined,
      settled: settled.length ? summarizeDistribution(settled) : undefined,
      durable: durable.length ? summarizeDistribution(durable) : undefined,
      lifecycle: lifecycle.length ? summarizeDistribution(lifecycle) : undefined,
      longTasks: summarizeDistribution(group.map((sample) => sample.longTaskTotalMs)),
      frameGaps: summarizeDistribution(group.map((sample) => sample.worstFrameGapMs)),
      failures: group.filter((sample) => !sample.success).length,
    }
  }).sort((left, right) => left.operationId.localeCompare(right.operationId))
}

export const pairedRegression = (baseline: DistributionSummary, candidate: DistributionSummary) => {
  const deltaMs = candidate.median - baseline.median
  const deltaRatio = baseline.median > 0 ? deltaMs / baseline.median : 0
  const noiseFloor = 3 * Math.max(baseline.mad, candidate.mad)
  return {
    deltaMs,
    deltaRatio,
    noiseFloor,
    regressed: deltaMs > 10 && deltaRatio > 0.15 && deltaMs > noiseFloor,
  }
}
