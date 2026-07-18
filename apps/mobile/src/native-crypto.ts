import * as ExpoCrypto from 'expo-crypto'
import * as ed25519 from '@noble/ed25519'
import { fromByteArray, toByteArray } from 'base64-js'

type NativeKeyMaterial =
  | { kind: 'aes'; value: ExpoCrypto.AESEncryptionKey }
  | { kind: 'ed-private'; value: Uint8Array }
  | { kind: 'ed-public'; value: Uint8Array }

class NativeCryptoKey {
  readonly algorithm: KeyAlgorithm
  constructor(readonly type: KeyType, readonly extractable: boolean, readonly usages: KeyUsage[], readonly material: NativeKeyMaterial) {
    this.algorithm = (material.kind === 'aes' ? { name: 'AES-GCM', length: 256 } : { name: 'Ed25519' }) as KeyAlgorithm
  }
}

const bytes = (value: BufferSource) => value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
const base64Url = (value: Uint8Array) => fromByteArray(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (value: string) => toByteArray(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='))
const requireKey = <Kind extends NativeKeyMaterial['kind']>(key: CryptoKey, kind: Kind) => {
  const native = key as unknown as NativeCryptoKey
  if (!(native instanceof NativeCryptoKey) || native.material.kind !== kind) throw new Error(`Expected ${kind} key.`)
  return native as NativeCryptoKey & { material: Extract<NativeKeyMaterial, { kind: Kind }> }
}

ed25519.hashes.sha512Async = async (message) => new Uint8Array(await ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA512, new Uint8Array(message)))

const subtle = {
  async generateKey(algorithm: AlgorithmIdentifier | AesKeyGenParams, extractable: boolean, usages: KeyUsage[]) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name
    if (name === 'AES-GCM') return new NativeCryptoKey('secret', extractable, usages, { kind: 'aes', value: await ExpoCrypto.AESEncryptionKey.generate(256) }) as unknown as CryptoKey
    if (name === 'Ed25519') {
      const secret = ExpoCrypto.getRandomBytes(32); const publicKey = await ed25519.getPublicKeyAsync(secret)
      return { privateKey: new NativeCryptoKey('private', extractable, usages.filter((value) => value === 'sign'), { kind: 'ed-private', value: secret }), publicKey: new NativeCryptoKey('public', true, ['verify'], { kind: 'ed-public', value: publicKey }) } as unknown as CryptoKeyPair
    }
    throw new Error(`Unsupported native key algorithm ${name}.`)
  },
  async importKey(format: KeyFormat, keyData: JsonWebKey | BufferSource, algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name
    if (name === 'AES-GCM' && format === 'raw') return new NativeCryptoKey('secret', extractable, usages, { kind: 'aes', value: await ExpoCrypto.AESEncryptionKey.import(bytes(keyData as BufferSource)) as ExpoCrypto.AESEncryptionKey }) as unknown as CryptoKey
    if (name === 'Ed25519' && format === 'pkcs8') return new NativeCryptoKey('private', extractable, usages, { kind: 'ed-private', value: bytes(keyData as BufferSource) }) as unknown as CryptoKey
    if (name === 'Ed25519' && format === 'jwk') {
      const jwk = keyData as JsonWebKey; if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) throw new Error('Invalid Ed25519 public JWK.')
      return new NativeCryptoKey('public', extractable, usages, { kind: 'ed-public', value: fromBase64Url(jwk.x) }) as unknown as CryptoKey
    }
    throw new Error(`Unsupported native key import ${format}/${name}.`)
  },
  async exportKey(format: KeyFormat, key: CryptoKey) {
    const native = key as unknown as NativeCryptoKey
    if (!native.extractable) throw new Error('The native key is not extractable.')
    if (format === 'raw' && native.material.kind === 'aes') return (await native.material.value.bytes()).buffer as ArrayBuffer
    if (format === 'pkcs8' && native.material.kind === 'ed-private') return native.material.value.buffer.slice(native.material.value.byteOffset, native.material.value.byteOffset + native.material.value.byteLength) as ArrayBuffer
    if (format === 'jwk' && native.material.kind === 'ed-public') return { kty: 'OKP', crv: 'Ed25519', x: base64Url(native.material.value), ext: true, key_ops: ['verify'] } satisfies JsonWebKey
    throw new Error(`Unsupported native key export ${format}.`)
  },
  async encrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource) {
    const native = requireKey(key, 'aes'); const value = native.material.value
    const sealed = await ExpoCrypto.aesEncryptAsync(bytes(data), value, { nonce: { bytes: bytes(algorithm.iv) }, additionalData: algorithm.additionalData ? bytes(algorithm.additionalData) : undefined })
    const ciphertext = await sealed.ciphertext({ encoding: 'bytes', includeTag: true }) as Uint8Array
    return ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
  },
  async decrypt(algorithm: AesGcmParams, key: CryptoKey, data: BufferSource) {
    const native = requireKey(key, 'aes'); const sealed = ExpoCrypto.AESSealedData.fromParts(bytes(algorithm.iv), bytes(data), 16)
    const plaintext = await ExpoCrypto.aesDecryptAsync(sealed, native.material.value, { additionalData: algorithm.additionalData ? bytes(algorithm.additionalData) : undefined })
    return plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer
  },
  async sign(_algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
    const native = requireKey(key, 'ed-private'); const signature = await ed25519.signAsync(bytes(data), native.material.value)
    return signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer
  },
  async verify(_algorithm: AlgorithmIdentifier, key: CryptoKey, signature: BufferSource, data: BufferSource) { const native = requireKey(key, 'ed-public'); return ed25519.verifyAsync(bytes(signature), bytes(data), native.material.value, { zip215: false }) },
  digest(algorithm: AlgorithmIdentifier, data: BufferSource) { const name = typeof algorithm === 'string' ? algorithm : algorithm.name; return ExpoCrypto.digest(name as ExpoCrypto.CryptoDigestAlgorithm, bytes(data)) },
}

export const installNativeCrypto = () => {
  const scope = globalThis as typeof globalThis & { crypto?: Crypto; CryptoKey?: typeof CryptoKey; btoa?: (value: string) => string; atob?: (value: string) => string }
  Object.defineProperty(scope, 'crypto', { configurable: true, value: { subtle, getRandomValues: ExpoCrypto.getRandomValues, randomUUID: ExpoCrypto.randomUUID } as unknown as Crypto })
  Object.defineProperty(scope, 'CryptoKey', { configurable: true, value: NativeCryptoKey })
  if (!scope.btoa) scope.btoa = (value) => fromByteArray(Uint8Array.from(value, (character) => character.charCodeAt(0)))
  if (!scope.atob) scope.atob = (value) => Array.from(toByteArray(value), (byte) => String.fromCharCode(byte)).join('')
}
