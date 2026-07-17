import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdatePanel } from './UpdatePanel'

afterEach(() => { window.neoAnkiDesktop = undefined })

describe('UpdatePanel', () => {
  it('explains manual releases and links to downloads', async () => {
    window.neoAnkiDesktop = {
      getReleaseInfo: async () => ({ currentVersion: '0.1.0', automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }),
    } as unknown as NeoAnkiDesktopBridge
    render(<UpdatePanel />)
    expect(await screen.findByText(/updates are installed manually/i)).toBeVisible()
    expect(screen.getByText(/releases are intentionally unsigned/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /view releases/i })).toHaveAttribute('href', 'https://github.com/neoanki/neo-anki/releases')
  })
})
