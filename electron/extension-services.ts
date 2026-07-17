import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { net, safeStorage } from 'electron'
import type { ExtensionNetworkRequest, ExtensionNetworkResponse } from '../packages/extension-sdk/src/index.js'
import type { ExtensionManager } from './extension-manager.js'

const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024
const FORBIDDEN_HEADERS = new Set(['cookie', 'host', 'content-length', 'origin', 'referer', 'connection', 'proxy-authorization'])
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/i

interface SecretState { version: 1; values: Record<string, string> }

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
  constructor(private readonly userDataRoot: string, private readonly manager: ExtensionManager) {}

  async claim(id: string) {
    await this.manager.requireEnabled(id)
    if (this.claimed.has(id)) throw new Error(`Extension ${id} already claimed its capability handle.`)
    const token = randomUUID()
    this.claimed.set(id, token)
    this.tokens.set(token, id)
    return token
  }

  private extensionId(token: string) {
    const id = this.tokens.get(token)
    if (!id) throw new Error('Extension capability handle is invalid or expired.')
    return id
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
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS credential storage is unavailable on this device.')
  }

  private assertKey(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error('Secret keys must be 1–120 letters, numbers, dots, dashes, or underscores.')
  }

  async hasSecret(token: string, key: string) {
    const id = this.extensionId(token)
    await this.manager.requirePermission(id, 'storage:secrets')
    this.assertKey(key)
    return Boolean((await this.readSecrets(id)).values[key])
  }

  async getSecret(token: string, key: string) {
    const id = this.extensionId(token)
    await this.manager.requirePermission(id, 'storage:secrets')
    this.assertKey(key)
    this.assertSecretSupport()
    const encrypted = (await this.readSecrets(id)).values[key]
    return encrypted ? safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : null
  }

  async setSecret(token: string, key: string, value: string) {
    const id = this.extensionId(token)
    await this.manager.requirePermission(id, 'storage:secrets')
    this.assertKey(key)
    this.assertSecretSupport()
    if (!value || value.length > 16_384) throw new Error('Secret values must be between 1 and 16,384 characters.')
    const state = await this.readSecrets(id)
    state.values[key] = safeStorage.encryptString(value).toString('base64')
    await this.writeSecrets(id, state)
  }

  async deleteSecret(token: string, key: string) {
    const id = this.extensionId(token)
    await this.manager.requirePermission(id, 'storage:secrets')
    this.assertKey(key)
    const state = await this.readSecrets(id)
    if (!(key in state.values)) return
    delete state.values[key]
    await this.writeSecrets(id, state)
  }

  async fetch(token: string, request: ExtensionNetworkRequest): Promise<ExtensionNetworkResponse> {
    const id = this.extensionId(token)
    const manifest = await this.manager.requirePermission(id, 'network:fetch')
    const domains = manifest.networkDomains || []
    const method = request.method || 'GET'
    const body = request.bodyBase64 ? Buffer.from(request.bodyBase64, 'base64') : request.body
    const bodyBytes = typeof body === 'string' ? Buffer.byteLength(body) : body?.byteLength || 0
    if (bodyBytes > MAX_REQUEST_BYTES) throw new Error('Extension network request exceeds 4 MB.')
    const headers = normalizedHeaders(request.headers)
    let url = new URL(request.url)
    for (let redirect = 0; redirect < 4; redirect += 1) {
      if (url.protocol !== 'https:' || !hostAllowed(url.hostname.toLowerCase(), domains)) throw new Error(`Extension ${id} is not allowed to contact ${url.hostname}.`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), Math.min(120_000, Math.max(1_000, request.timeoutMs || 30_000)))
      try {
        const response = await net.fetch(url.toString(), { method, headers, body, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) throw new Error('Network redirect is missing its destination.')
          url = new URL(location, url)
          continue
        }
        const declaredLength = Number(response.headers.get('content-length') || 0)
        if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Extension network response exceeds 25 MB.')
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Extension network response exceeds 25 MB.')
        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          bodyBase64: Buffer.from(bytes).toString('base64'),
        }
      } finally { clearTimeout(timeout) }
    }
    throw new Error('Extension network request followed too many redirects.')
  }
}
