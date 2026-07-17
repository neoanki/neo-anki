import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdatePanel } from './UpdatePanel'

afterEach(() => { window.neoAnkiDesktop = undefined })

describe('UpdatePanel', () => {
  it('requires explicit confirmation before downloading an available update', async () => {
    const downloadUpdate = vi.fn(async () => ({ phase: 'downloading', currentVersion: '0.1.0', version: '0.2.0', percent: 0 } as NeoAnkiUpdateState))
    window.neoAnkiDesktop = {
      getUpdateState: async () => ({ phase: 'available', currentVersion: '0.1.0', version: '0.2.0' }),
      downloadUpdate,
      onUpdateState: () => () => undefined,
    } as unknown as NeoAnkiDesktopBridge
    render(<UpdatePanel />)
    const button = await screen.findByRole('button', { name: /download 0.2.0/i })
    expect(downloadUpdate).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(await screen.findByRole('progressbar', { name: /update download/i })).toBeVisible()
  })
})
