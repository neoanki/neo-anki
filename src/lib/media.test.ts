import { describe, expect, it } from 'vitest'
import { bytesToDataUrl, createAssetFromBytes, dataUrlToBytes, mimeFromFilename } from './media'

describe('media assets', () => {
  it('detects MIME types and round-trips bytes through data URLs', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(mimeFromFilename('photo.JPG')).toBe('image/jpeg')
    expect(mimeFromFilename('voice.mp3')).toBe('audio/mpeg')
    expect(mimeFromFilename('unknown.bin')).toBe('application/octet-stream')
    expect(dataUrlToBytes(bytesToDataUrl(bytes, 'application/octet-stream'))).toEqual(bytes)
    const asset = await createAssetFromBytes('photo.png', bytes, 'A tiny diagram')
    expect(asset).toMatchObject({ filename: 'photo.png', mimeType: 'image/png', byteLength: 5, altText: 'A tiny diagram' })
    expect(asset.hash).toHaveLength(64)
  })
})
