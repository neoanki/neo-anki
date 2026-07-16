import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import axe from 'axe-core'
import { App } from './App'
import { createSeedData } from './data/seed'
import { AppProvider } from './state/AppContext'

const renderApp = (onboarded = true) => {
  const data = createSeedData()
  data.settings.onboardingComplete = onboarded
  localStorage.setItem('neo-anki:data:v1', JSON.stringify(data))
  return render(<AppProvider><App /></AppProvider>)
}

describe('application workflows', () => {
  it('onboards around time instead of a fixed new-card count', async () => {
    renderApp(false)
    expect(screen.getByRole('heading', { name: /how much time can learning reliably have/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /30 minutes/i }))
    await userEvent.click(screen.getByRole('button', { name: /build my first plan/i }))
    expect(screen.getByRole('heading', { name: /today’s study plan/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /30 min available/i })).toBeInTheDocument()
  })

  it('creates typed knowledge and exposes it in the library', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: /new item/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Typed answer' }))
    await userEvent.type(screen.getByLabelText('Prompt or cloze sentence'), 'What is the testing pyramid?')
    await userEvent.type(screen.getByLabelText('Answer'), 'Unit, integration, and end-to-end tests')
    await userEvent.click(screen.getByRole('button', { name: /add knowledge/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/safe new-material queue/i)
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(screen.getByText('What is the testing pyramid?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'typed' })).toBeInTheDocument()
  })

  it('creates a learning goal from Plans', async () => {
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Plans' })[0])
    const form = screen.getByRole('heading', { name: 'Add learning goal' }).closest('form')!
    await userEvent.type(within(form).getByLabelText('Name'), 'Ship Phase 2')
    await userEvent.type(within(form).getByLabelText(/search terms/i), 'testing')
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Ship Phase 2')).toBeInTheDocument()
  })

  it('has no automatically detectable serious accessibility violations on Today', async () => {
    renderApp()
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''))).toEqual([])
  })
})
