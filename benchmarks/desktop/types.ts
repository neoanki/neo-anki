export type BenchmarkDataset = 'fresh' | 'small' | 'typical' | 'large'
export type BenchmarkTier = 'smoke' | 'full' | 'endurance'
export type BenchmarkStage = 'feedback' | 'settled' | 'durable' | 'lifecycle'
export type OperationDisposition = 'measured' | 'setup-only' | 'os-owned' | 'excluded'

export interface OperationSpec {
  id: string
  area: 'lifecycle' | 'recovery' | 'navigation' | 'today' | 'authoring' | 'library' | 'review' | 'settings' | 'sync'
  label: string
  tier: BenchmarkTier
  dataset: BenchmarkDataset
  stages: BenchmarkStage[]
  disposition: OperationDisposition
  variants?: string[]
  reason?: string
}

export interface RendererProbeSnapshot {
  eventToPaintMs?: number
  longTaskCount: number
  longTaskTotalMs: number
  longestTaskMs: number
  frameGapP95Ms: number
  worstFrameGapMs: number
}

export interface ProcessSnapshot {
  residentSetBytes: number
  privateBytes: number
  cpuPercent: number
}

export interface BenchmarkSample extends RendererProbeSnapshot {
  operationId: string
  iteration: number
  dataset: BenchmarkDataset
  tier: BenchmarkTier
  feedbackMs?: number
  settledMs?: number
  durableMs?: number
  lifecycleMs?: number
  beforeProcess?: ProcessSnapshot
  afterProcess?: ProcessSnapshot
  success: boolean
  error?: string
  measuredAt: string
}

export interface DistributionSummary {
  count: number
  median: number
  p95: number
  max: number
  mad: number
}

export interface OperationSummary {
  operationId: string
  dataset: BenchmarkDataset
  feedback?: DistributionSummary
  settled?: DistributionSummary
  durable?: DistributionSummary
  lifecycle?: DistributionSummary
  longTasks: DistributionSummary
  frameGaps: DistributionSummary
  failures: number
}

export interface BenchmarkBudget {
  operationId: string
  stage: BenchmarkStage
  absoluteLimitMs: number
  calibratedMedianMs?: number
  calibratedMadMs?: number
  enforcement: 'calibrating' | 'gated' | 'debt'
}

export interface BenchmarkRunMetadata {
  runId: string
  mode: 'smoke' | 'full' | 'calibrate' | 'endurance' | 'compare'
  platform: 'darwin'
  arch: 'arm64'
  osVersion: string
  nodeVersion: string
  appPath: string
  appSha256: string
  gitCommit: string
  cpuModel: string
  logicalCpus: number
  totalMemoryBytes: number
  headless: true
  iterations: number
  startedAt: string
}

export interface BenchmarkReport {
  metadata: BenchmarkRunMetadata
  catalogVersion: number
  samples: BenchmarkSample[]
  summaries: OperationSummary[]
  budgets: BenchmarkBudget[]
  missingOperationIds: string[]
  enduranceMemory?: {
    operations: number
    rssGrowthBytes: number
    rssGrowthPercent: number
    privateGrowthBytes: number
    privateGrowthPercent: number
    passed: boolean
  }
}
