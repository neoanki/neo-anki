import type { CSSProperties } from 'react'
import type { OcclusionRect } from '../types'

const bounded = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
export const normalizeRect = (rect: Omit<OcclusionRect, 'id'> & { id?: string }): OcclusionRect => {
  const x = bounded(rect.x); const y = bounded(rect.y)
  return { ...rect, id: rect.id || crypto.randomUUID(), x, y, width: Math.min(100 - x, Math.max(2, bounded(rect.width))), height: Math.min(100 - y, Math.max(2, bounded(rect.height))) }
}
export const rectFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }, label = ''): OcclusionRect => normalizeRect({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y), label })
export const rectStyle = (rect: OcclusionRect): CSSProperties => ({ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` })
