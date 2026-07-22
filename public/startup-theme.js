try {
  const theme = globalThis.localStorage.getItem('neo-anki:last-theme')
  if (theme === 'dark' || theme === 'light') globalThis.document.documentElement.dataset.theme = theme
} catch { /* The system theme remains a safe fallback. */ }
