import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdatePanel } from './UpdatePanel'

afterEach(() => { window.neoAnkiDesktop = undefined })

describe('UpdatePanel', () => {
  it('explains manual community releases and links to attested downloads', async () => {
    window.neoAnkiDesktop = {
      getReleaseInfo: async () => ({ currentVersion: '0.1.0', channel: 'community', automaticUpdates: false, releasesUrl: 'https://github.com/neoanki/neo-anki/releases' }),
    } as unknown as NeoAnkiDesktopBridge
    render(<UpdatePanel />)
    expect(await screen.findByText(/community builds update manually/i)).toBeVisible()
    expect(screen.getByText(/not backed by apple or microsoft code-signing certificates/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /view verified releases/i })).toHaveAttribute('href', 'https://github.com/neoanki/neo-anki/releases')
  })
})
