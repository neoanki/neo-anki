import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { net, safeStorage } from 'electron'
import type { ExtensionManager } from './extension-manager.js'
import { secureSecretStorageAvailable } from './secret-backend.js'

const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const FORBIDDEN_HEADERS = new Set(['cookie', 'host', 'content-length', 'origin', 'referer', 'connection', 'proxy-authorization'])
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/i

interface SecretState { version: 1; values: Record<string, string> }
interface ExtensionNetworkRequest { operationId?: string; url: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; bodyBase64?: string; timeoutMs?: number; maximumResponseBytes?: number }
interface ExtensionNetworkResponse { status: number; statusText: string; headers: Record<string, string>; bodyBase64: string }
type ExtensionFetcher = (input: string, init?: RequestInit) => Promise<Response>

const hostAllowed = (hostname: string, domains: string[]) => domains.some((domain) => domain.startsWith('*.')
  ? hostname.endsWith(domain.slice(1)) && hostname.length > domain.length - 1
  : hostname === domain)

const normalizedHeaders = (headers: Record<string, string> = {}) => Object.fromEntries(Object.entries(headers).map(([name, value]) => {
  const normalized = name.toLowerCase().trim()
  if (!normalized || FORBIDDEN_HEADERS.has(normalized) || /[\r\n]/.test(name) || /[\r\n]/.test(value)) throw new Error(`Network header ${name || '(empty)'} is not allowed.`)
  return [normalized, String(value)]
}))

export class ExtensionServices {
  private claimed = new Map<string, string>()
  private tokens = new Map<string, string>()
  private secretQueues = new Map<string, Promise<void>>()
  private networkControllers = new Map<string, AbortController>()
  constructor(private readonly userDataRoot: string, private readonly manager: ExtensionManager, private readonly fetcher: ExtensionFetcher = net.fetch) {}

  async claim(id: string) {
    await this.manager.requireEnabled(id)
    if (this.claimed.has(id)) throw new Error(`Extension ${id} already claimed its capability handle.`)
    const token = randomUUID()
    this.claimed.set(id, token)
    this.tokens.set(token, id)
    return token
  }

  release(id?: string) {
    const ids = id ? [id] : [...this.claimed.keys()]
    for (const extensionId of ids) {
      const token = this.claimed.get(extensionId)
      if (!token) continue
      for (const [operationKey, controller] of this.networkControllers) if (operationKey.startsWith(`${token}:`)) { controller.abort(); this.networkControllers.delete(operationKey) }
      this.tokens.delete(token)
      this.claimed.delete(extensionId)
    }
  }

  private extensionId(token: string) {
    const id = this.tokens.get(token)
    if (!id) throw new Error('Extension capability handle is invalid or expired.')
    return id
  }

  async authorize(token: string, permission: 'content:patch-own' | 'content:migrate' | 'media:create' | 'config:sync' | 'content:read') {
    const id = this.extensionId(token)
    await this.manager.requirePermission(id, permission)
    return id
  }

  private async requireSecrets(id: string) {
    await this.manager.requirePermission(id, 'secrets:device')
  }

  private secretsPath(id: string) { return join(this.userDataRoot, 'extensions', 'data', id, 'secrets.json') }

  private async readSecrets(id: string): Promise<SecretState> {
    const path = this.secretsPath(id)
    if (!existsSync(path)) return { version: 1, values: {} }
    const value = JSON.parse(await readFile(path, 'utf8')) as SecretState
    if (value.version !== 1 || !value.values || typeof value.values !== 'object') throw new Error('Extension secret storage is damaged.')
    return value
  }

  private async writeSecrets(id: string, state: SecretState) {
    const path = this.secretsPath(id)
    await mkdir(join(this.userDataRoot, 'extensions', 'data', id), { recursive: true })
    const temporary = `${path}.${randomUUID()}.next`
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  }

  private assertSecretSupport() {
    const linuxBackend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    if (!secureSecretStorageAvailable(process.platform, safeStorage.isEncryptionAvailable(), linuxBackend)) {
      throw new Error('Secure OS credential storage is unavailable on this device. Linux requires Secret Service or KWallet; basic_text is not accepted.')
    }
  }

  private assertKey(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error('Secret keys must be 1–120 letters, numbers, dots, dashes, or underscores.')
  }

  private async withSecretLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.secretQueues.get(id) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.catch(() => undefined).then(() => current)
    this.secretQueues.set(id, queued)
    await previous.catch(() => undefined)
    try { return await operation() }
    finally {
      release()
      if (this.secretQueues.get(id) === queued) this.secretQueues.delete(id)
    }
  }

  async deleteAllSecrets(id: string) {
    await this.withSecretLock(id, async () => { await rm(this.secretsPath(id), { force: true }) })
    this.release(id)
  }

  async readSecretBatch(token: string, keys: string[]) {
    const id = this.extensionId(token); await this.requireSecrets(id); this.assertSecretSupport()
    if (!Array.isArray(keys) || keys.length > 100) throw new Error('An extension may read at most 100 secrets at once.')
    keys.forEach((key) => this.assertKey(key))
    return this.withSecretLock(id, async () => {
      const state = await this.readSecrets(id)
      return Object.fromEntries(keys.map((key) => [key, state.values[key] ? safeStorage.decryptString(Buffer.from(state.values[key], 'base64')) : null]))
    })
  }

  async mutateSecretBatch(token: string, changes: Array<{ op: 'set'; key: string; value: string } | { op: 'delete'; key: string }>) {
    const id = this.extensionId(token); await this.requireSecrets(id); this.assertSecretSupport()
    if (!Array.isArray(changes) || changes.length > 100) throw new Error('An extension may change at most 100 secrets at once.')
    changes.forEach((change) => { this.assertKey(change.key); if (change.op === 'set' && (!change.value || change.value.length > 16_384)) throw new Error('Secret values must be between 1 and 16,384 characters.') })
    await this.withSecretLock(id, async () => {
      const state = await this.readSecrets(id)
      for (const change of changes) if (change.op === 'set') state.values[change.key] = safeStorage.encryptString(change.value).toString('base64'); else delete state.values[change.key]
      await this.writeSecrets(id, state)
    })
  }

  private async readBoundedResponse(response: Response, limit = MAX_RESPONSE_BYTES) {
    if (!response.body) return new Uint8Array()
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > limit) {
          await reader.cancel('Response exceeded Neo Anki extension limit.')
          throw new Error(`Extension network response exceeds ${limit} bytes.`)
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  }

  async fetch(token: string, request: ExtensionNetworkRequest): Promise<ExtensionNetworkResponse> {
    const id = this.extensionId(token)
    const manifest = await this.manager.requirePermission(id, 'network:fetch')
    const domains = manifest.networkDomains || []
    let method = request.method || 'GET'
    let body = request.bodyBase64 ? Buffer.from(request.bodyBase64, 'base64') : undefined
    const bodyBytes = body?.byteLength || 0
    if (bodyBytes > MAX_REQUEST_BYTES) throw new Error('Extension network request exceeds 4 MB.')
    let headers = normalizedHeaders(request.headers)
    let url = new URL(request.url)
    for (let redirect = 0; redirect < 4; redirect += 1) {
      if (url.protocol !== 'https:' || !hostAllowed(url.hostname.toLowerCase(), domains)) throw new Error(`Extension ${id} is not allowed to contact ${url.hostname}.`)
      const controller = new AbortController()
      const operationKey = request.operationId ? `${token}:${request.operationId}` : ''
      if (operationKey) { if (this.networkControllers.has(operationKey)) throw new Error('Extension network operation id is already active.'); this.networkControllers.set(operationKey, controller) }
      const timeout = setTimeout(() => controller.abort(), Math.min(120_000, Math.max(1_000, request.timeoutMs || 30_000)))
      try {
        const response = await this.fetcher(url.toString(), { method, headers, body, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) throw new Error('Network redirect is missing its destination.')
          const redirected = new URL(location, url)
          if (redirected.hostname.toLowerCase() !== url.hostname.toLowerCase()) {
            const { authorization: _authorization, ...remaining } = headers
            headers = remaining
          }
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET'
            body = undefined
            const { 'content-type': _contentType, ...remaining } = headers
            headers = remaining
          }
          await response.body?.cancel()
          url = redirected
          continue
        }
        const responseLimit = Math.min(MAX_RESPONSE_BYTES, Math.max(1, request.maximumResponseBytes || MAX_RESPONSE_BYTES))
        const declaredLength = Number(response.headers.get('content-length') || 0)
        if (declaredLength > responseLimit) throw new Error(`Extension network response exceeds ${responseLimit} bytes.`)
        const bytes = await this.readBoundedResponse(response, responseLimit)
        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          bodyBase64: Buffer.from(bytes).toString('base64'),
        }
      } finally { clearTimeout(timeout); if (operationKey) this.networkControllers.delete(operationKey) }
    }
    throw new Error('Extension network request followed too many redirects.')
  }

  cancel(token: string, operationId: string) {
    if (!operationId) return
    this.networkControllers.get(`${token}:${operationId}`)?.abort()
  }
}
