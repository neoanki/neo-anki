import type { OcclusionRect } from '../types'

const clamp = (value: number) => Math.min(100, Math.max(0, value))

export const normalizeRect = (rect: Omit<OcclusionRect, 'id'> & { id?: string }): OcclusionRect => {
  const x = clamp(rect.x)
  const y = clamp(rect.y)
  return {
    id: rect.id || crypto.randomUUID(),
    x,
    y,
    width: Math.min(100 - x, Math.max(2, rect.width)),
    height: Math.min(100 - y, Math.max(2, rect.height)),
    label: rect.label,
  }
}

export const rectFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }) => normalizeRect({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
})

export const rectStyle = (rect: OcclusionRect) => ({
  left: `${rect.x}%`,
  top: `${rect.y}%`,
  width: `${rect.width}%`,
  height: `${rect.height}%`,
})
