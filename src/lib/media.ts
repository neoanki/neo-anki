import type { MediaAsset } from '../types.js'

const extensionMime: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
}

export const mimeFromFilename = (filename: string) => extensionMime[filename.split('.').pop()?.toLocaleLowerCase() || ''] || 'application/octet-stream'

export const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) => {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  return `data:${mimeType};base64,${btoa(binary)}`
}

export const dataUrlToBytes = (dataUrl: string) => {
  const encoded = dataUrl.split(',')[1] || ''
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export const hashBytes = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

export const createAssetFromBytes = async (filename: string, bytes: Uint8Array, altText = '', mimeType = mimeFromFilename(filename)): Promise<MediaAsset> => {
  const timestamp = new Date().toISOString()
  const hash = await hashBytes(bytes)
  return {
    id: `asset-${hash.slice(0, 20)}`,
    filename,
    mimeType,
    dataUrl: bytesToDataUrl(bytes, mimeType),
    byteLength: bytes.byteLength,
    hash,
    altText,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export const fileToAsset = async (file: File, altText = '') => createAssetFromBytes(file.name, new Uint8Array(await file.arrayBuffer()), altText, file.type || mimeFromFilename(file.name))
