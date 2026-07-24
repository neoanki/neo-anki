import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { BenchmarkBudget, BenchmarkReport, BenchmarkRunMetadata, BenchmarkSample, OperationSummary } from './types'
import { CATALOG_VERSION, initialBudgets, operationsForTier } from './catalog'
import { summarizeSamples } from './statistics'

const samples: BenchmarkSample[] = []
let recordingEnabled = true
const storedBudgetPath = join(process.cwd(), 'benchmarks', 'desktop', 'budgets.macos-arm64.json')
const storedBudgets = existsSync(storedBudgetPath)
  ? JSON.parse(readFileSync(storedBudgetPath, 'utf8')) as BenchmarkBudget[]
  : initialBudgets

export const recordSample = (sample: BenchmarkSample) => {
  if (recordingEnabled) samples.push(sample)
}
export const recordedSamples = () => [...samples]
export const resetSamples = () => { samples.length = 0 }
export const setBenchmarkRecording = (enabled: boolean) => { recordingEnabled = enabled }

const sha256File = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('error', reject)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolve(hash.digest('hex')))
})

const metricFor = (summary: OperationSummary, stage: BenchmarkBudget['stage']) => {
  if (stage === 'feedback') return summary.feedback
  if (stage === 'settled') return summary.settled
  if (stage === 'durable') return summary.durable
  return summary.lifecycle
}

const calibratedBudgets = (summaries: OperationSummary[], calibrate: boolean) => initialBudgets.map((budget) => {
  if (!calibrate) {
    return storedBudgets.find((candidate) =>
      candidate.operationId === budget.operationId && candidate.stage === budget.stage) || budget
  }
  const summary = summaries.find((candidate) => candidate.operationId === budget.operationId)
  const metric = summary ? metricFor(summary, budget.stage) : undefined
  if (!metric?.count) return budget
  return {
    ...budget,
    calibratedMedianMs: metric.median,
    calibratedMadMs: metric.mad,
    enforcement: metric.p95 <= budget.absoluteLimitMs ? 'gated' as const : 'debt' as const,
  }
})

const markdownReport = (report: BenchmarkReport) => {
  const rows = report.summaries.map((summary) => {
    const metric = summary.durable || summary.settled || summary.feedback || summary.lifecycle
    const budget = report.budgets.find((candidate) => candidate.operationId === summary.operationId && candidate.stage === (summary.durable ? 'durable' : summary.settled ? 'settled' : summary.feedback ? 'feedback' : 'lifecycle'))
    return `| ${summary.operationId} | ${metric?.median.toFixed(1) || '—'} | ${metric?.p95.toFixed(1) || '—'} | ${metric?.max.toFixed(1) || '—'} | ${budget?.absoluteLimitMs || '—'} | ${budget?.enforcement || '—'} | ${summary.failures} |`
  })
  return `# Neo Anki macOS arm64 benchmark

- Mode: ${report.metadata.mode}
- App: \`${report.metadata.appPath}\`
- Commit: \`${report.metadata.gitCommit}\`
- macOS: ${report.metadata.osVersion}
- CPU: ${report.metadata.cpuModel} (${report.metadata.logicalCpus} logical cores)
- Iterations: ${report.metadata.iterations}
- Missing catalog operations: ${report.missingOperationIds.length ? report.missingOperationIds.join(', ') : 'none'}
${report.enduranceMemory ? `- 100-operation retained memory: ${report.enduranceMemory.passed ? 'pass' : 'FAIL'} (RSS ${(report.enduranceMemory.rssGrowthBytes / 1_048_576).toFixed(1)} MB / ${report.enduranceMemory.rssGrowthPercent.toFixed(1)}%; private ${(report.enduranceMemory.privateGrowthBytes / 1_048_576).toFixed(1)} MB / ${report.enduranceMemory.privateGrowthPercent.toFixed(1)}%)` : ''}

| Operation | Median ms | p95 ms | Max ms | Budget ms | State | Failures |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
${rows.join('\n')}
`
}

export const writeBenchmarkReport = async (options: {
  appPath: string
  outputDirectory: string
  mode: BenchmarkRunMetadata['mode']
  iterations: number
  tier: 'smoke' | 'full' | 'endurance'
  requireCompleteCatalog: boolean
}) => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Desktop benchmarks only support macOS arm64.')
  const appSha256 = await sha256File(options.appPath)
  const summaries = summarizeSamples(samples)
  const requiredIds = new Set(operationsForTier(options.tier).map((operation) => operation.id))
  const observedIds = new Set(samples.filter((sample) => sample.success).map((sample) => sample.operationId))
  const missingOperationIds = [...requiredIds].filter((id) => !observedIds.has(id)).sort()
  const enduranceSamples = samples.filter((sample) =>
    sample.tier === 'endurance'
    && sample.operationId === 'navigation.routes.warm'
    && sample.dataset === 'small'
    && sample.beforeProcess
    && sample.afterProcess)
  const firstEndurance = enduranceSamples[0]?.beforeProcess
  const lastEndurance = samples.find((sample) =>
    sample.tier === 'endurance'
    && sample.operationId === 'endurance.memory.settled')?.afterProcess
    || enduranceSamples.at(-1)?.afterProcess
  const rssGrowthBytes = firstEndurance && lastEndurance
    ? lastEndurance.residentSetBytes - firstEndurance.residentSetBytes
    : 0
  const privateGrowthBytes = firstEndurance && lastEndurance
    ? lastEndurance.privateBytes - firstEndurance.privateBytes
    : 0
  const rssGrowthPercent = firstEndurance?.residentSetBytes
    ? (rssGrowthBytes / firstEndurance.residentSetBytes) * 100
    : 0
  const privateGrowthPercent = firstEndurance?.privateBytes
    ? (privateGrowthBytes / firstEndurance.privateBytes) * 100
    : 0
  const enduranceMemory = enduranceSamples.length >= 100 ? {
    operations: enduranceSamples.length,
    rssGrowthBytes,
    rssGrowthPercent,
    privateGrowthBytes,
    privateGrowthPercent,
    passed: !(
      (rssGrowthBytes > 50 * 1_048_576 && rssGrowthPercent > 10)
      || (privateGrowthBytes > 50 * 1_048_576 && privateGrowthPercent > 10)
    ),
  } : undefined
  const metadata: BenchmarkRunMetadata = {
    runId: `${Date.now()}-${process.pid}`,
    mode: options.mode,
    platform: 'darwin',
    arch: 'arm64',
    osVersion: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    nodeVersion: process.version,
    appPath: options.appPath,
    appSha256,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    cpuModel: cpus()[0]?.model || 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    headless: true,
    iterations: options.iterations,
    startedAt: new Date().toISOString(),
  }
  const report: BenchmarkReport = {
    metadata,
    catalogVersion: CATALOG_VERSION,
    samples: [...samples],
    summaries,
    budgets: calibratedBudgets(summaries, options.mode === 'calibrate'),
    missingOperationIds,
    enduranceMemory,
  }
  await mkdir(options.outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(options.outputDirectory, 'raw.jsonl'), `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`, 'utf8'),
    writeFile(join(options.outputDirectory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(join(options.outputDirectory, 'report.md'), markdownReport(report), 'utf8'),
    writeFile(join(options.outputDirectory, 'calibrated-budgets.json'), `${JSON.stringify(report.budgets, null, 2)}\n`, 'utf8'),
  ])
  if (options.requireCompleteCatalog && missingOperationIds.length) {
    throw new Error(`Benchmark catalog is incomplete for ${options.tier}: ${missingOperationIds.join(', ')}`)
  }
  const gatedFailures = report.budgets.filter((budget) => {
    if (options.mode === 'calibrate' || budget.enforcement !== 'gated') return false
    const summary = summaries.find((candidate) => candidate.operationId === budget.operationId)
    const metric = summary ? metricFor(summary, budget.stage) : undefined
    return Boolean(metric && metric.p95 > budget.absoluteLimitMs)
  })
  if (gatedFailures.length) {
    throw new Error(`Gated benchmark budgets failed: ${gatedFailures.map((budget) =>
      `${budget.operationId}:${budget.stage}`).join(', ')}`)
  }
  if (enduranceMemory && !enduranceMemory.passed) {
    throw new Error('Endurance retained-memory gate failed.')
  }
  return report
}

export const ensureParentDirectory = (path: string) => mkdir(dirname(path), { recursive: true })
