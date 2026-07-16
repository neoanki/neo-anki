export const startOfDay = (date: Date) => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export const endOfDay = (date: Date) => {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

export const addDays = (date: Date, days: number) => {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export const dayKey = (date: Date) => startOfDay(date).toISOString().slice(0, 10)

export const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} sec`
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

export const formatDue = (iso: string, now = new Date()) => {
  const due = new Date(iso)
  const diff = due.getTime() - now.getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes <= 0) return 'Due now'
  if (minutes < 60) return `In ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `In ${hours}h`
  const days = Math.round(hours / 24)
  return `In ${days}d`
}

export const isToday = (iso: string, now = new Date()) => dayKey(new Date(iso)) === dayKey(now)
