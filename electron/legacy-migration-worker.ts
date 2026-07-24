import { parentPort, workerData } from 'node:worker_threads'
import { WorkspaceStore } from './workspace-store.js'

type MigrationWorkerInput = { userDataRoot: string; reportTiming?: boolean }

const run = () => {
  const input = workerData as MigrationWorkerInput
  if (!input?.userDataRoot) throw new Error('The legacy migration worker did not receive a workspace path.')
  const started = performance.now()
  const mark = (stage: string) => {
    if (input.reportTiming) parentPort?.postMessage({ type: 'timing', stage, elapsedMs: performance.now() - started })
  }
  const store = new WorkspaceStore(input.userDataRoot, { preserveLegacySource: false })
  mark('store-opened')
  try {
    const data = store.load()
    mark('legacy-validated')
    if (!data) throw new Error('The legacy workspace is unavailable.')
    store.finishDeferredLegacyMigration()
    mark('snapshot-committed')
  } finally {
    store.close()
    mark('database-closed')
  }
}

try {
  run()
  parentPort?.postMessage({ ok: true })
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : 'Legacy migration failed.' })
  process.exitCode = 1
}
