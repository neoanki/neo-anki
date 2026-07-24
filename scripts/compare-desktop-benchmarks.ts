import { readFileSync } from 'node:fs'
import type { BenchmarkReport, DistributionSummary, OperationSummary } from '../benchmarks/desktop/types'
import { pairedRegression } from '../benchmarks/desktop/statistics'

const [baselinePath, candidatePath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) throw new Error('Usage: tsx scripts/compare-desktop-benchmarks.ts <baseline-summary.json> <candidate-summary.json>')

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as BenchmarkReport
const baseline = read(baselinePath)
const candidate = read(candidatePath)
if (baseline.metadata.platform !== 'darwin' || baseline.metadata.arch !== 'arm64' || candidate.metadata.platform !== 'darwin' || candidate.metadata.arch !== 'arm64') {
  throw new Error('Only macOS arm64 benchmark reports can be compared.')
}

const preferredMetric = (summary: OperationSummary): DistributionSummary | undefined =>
  summary.durable || summary.settled || summary.feedback || summary.lifecycle

const regressions: string[] = []
for (const current of candidate.summaries) {
  const previous = baseline.summaries.find((summary) => summary.operationId === current.operationId && summary.dataset === current.dataset)
  const before = previous && preferredMetric(previous)
  const after = preferredMetric(current)
  if (!before || !after) continue
  const comparison = pairedRegression(before, after)
  const percent = (comparison.deltaRatio * 100).toFixed(1)
  console.log(`${current.operationId}: ${before.median.toFixed(1)} ms -> ${after.median.toFixed(1)} ms (${percent}%, noise ${comparison.noiseFloor.toFixed(1)} ms)${comparison.regressed ? ' REGRESSION' : ''}`)
  if (comparison.regressed) regressions.push(current.operationId)
}
if (candidate.missingOperationIds.length) regressions.push(...candidate.missingOperationIds.map((id) => `missing:${id}`))
if (regressions.length) {
  console.error(`Desktop benchmark comparison failed: ${regressions.join(', ')}`)
  process.exitCode = 1
}
