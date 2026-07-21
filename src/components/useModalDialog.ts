import { useCallback, useEffect, useRef } from 'react'

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const useModalDialog = <T extends HTMLElement = HTMLElement>(onClose: () => void, options: { dirty?: boolean; dirtyMessage?: string } = {}) => {
  const dialogRef = useRef<T>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const requestClose = useCallback(() => {
    if (options.dirty && !window.confirm(options.dirtyMessage || 'Discard unsaved changes?')) return
    onClose()
  }, [onClose, options.dirty, options.dirtyMessage])
  const requestCloseRef = useRef(requestClose)
  useEffect(() => { requestCloseRef.current = requestClose }, [requestClose])

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (!dialog) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = dialog.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not([aria-label^="Close"])')
    window.requestAnimationFrame(() => (first || dialog).focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); requestCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      if (!controls.length) { event.preventDefault(); dialog.focus(); return }
      const firstControl = controls[0]
      const lastControl = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl.focus() }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.requestAnimationFrame(() => returnFocus.current?.focus())
    }
  }, [])

  const onBackdropMouseDown = (event: React.MouseEvent<HTMLElement>) => { if (event.target === event.currentTarget) requestClose() }
  return [dialogRef, requestClose, onBackdropMouseDown] as const
}
