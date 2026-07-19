/** Returns a normalized external web URL, or null for executable/ambiguous schemes. */
export const safeExternalUrl = (value: string | undefined) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
