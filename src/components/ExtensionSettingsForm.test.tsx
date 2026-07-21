import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionManifestV2 } from '../../packages/extension-sdk/src/index'
import { prepareExtensionHost } from '../extensions/host'
import { ExtensionSettingsForm } from './ExtensionSettingsForm'

const manifest = (id: string): ExtensionManifestV2 => ({
  format: 'neo-anki-extension', schemaVersion: 2, sdkVersion: 2, id, name: 'Settings Fixture', version: '2.0.0', publisher: 'Fixture', publisherKey: 'fixture',
  permissions: ['config:sync', 'secrets:device'], workerEntry: 'worker.js', provenance: { sourceCommit: 'a'.repeat(40), buildSystem: 'fixture' },
  settings: { schemaVersion: 1, helpText: 'Neo Anki renders these settings.', sections: [
    { id: 'general', title: 'General', controls: [
      { id: 'privacy', kind: 'notice', tone: 'privacy', text: 'The credential stays on this device.' },
      { id: 'enabled', kind: 'toggle', path: '/enabled', label: 'Enable fixture', defaultValue: true },
      { id: 'seconds', kind: 'number', path: '/seconds', label: 'Seconds', defaultValue: 30, min: 5, max: 60, requiredWhen: { path: '/enabled', operator: 'truthy' } },
      { id: 'mode', kind: 'select', path: '/mode', label: 'Mode', defaultValue: 'basic', options: [{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }] },
      { id: 'advanced-detail', kind: 'text', path: '/advancedDetail', label: 'Advanced detail', maxLength: 100, visibleWhen: { path: '/mode', operator: 'equals', value: 'advanced' }, requiredWhen: { path: '/mode', operator: 'equals', value: 'advanced' } },
      { id: 'api-key', kind: 'secret', label: 'API key', secretKey: 'provider.key' },
    ] },
    { id: 'profiles', title: 'Profiles', controls: [
      { id: 'profile-list', kind: 'group', path: '/profiles', label: 'Profile', itemIdPath: '/id', itemLabelPath: '/name', defaultItems: [{ id: 'one', name: 'Primary', tracks: [{ id: 'track-one', name: 'Prompt' }] }], newItem: { name: 'New profile' }, maxItems: 3, fields: [
        { id: 'profile-name', kind: 'text', path: '/name', label: 'Name', required: true, defaultValue: 'Profile' },
        { id: 'track-list', kind: 'group', path: '/tracks', label: 'Track', itemIdPath: '/id', itemLabelPath: '/name', newItem: { name: 'New track' }, maxItems: 3, fields: [{ id: 'track-name', kind: 'text', path: '/name', label: 'Track name', required: true }] },
      ] },
    ] },
  ] },
})

const installBridge = (id: string, overrides: Partial<NeoAnkiDesktopBridge> = {}) => {
  const extensionConfigWriteV2 = vi.fn(async (_token: string, value: unknown) => ({ workspaceRevision: 2, data: { saved: value } as never }))
  const extensionSecretMutateBatchV2 = vi.fn(async () => undefined)
  window.neoAnkiDesktop = {
    claimExtensionCapability: vi.fn(async (extensionId: string) => `token:${extensionId}`),
    extensionConfigReadV2: vi.fn(async () => ({ enabled: false, unknown: 'preserved' })),
    extensionConfigWriteV2,
    extensionSecretStatusBatchV2: vi.fn(async () => ({ 'provider.key': false })),
    extensionSecretMutateBatchV2,
    ...overrides,
  } as NeoAnkiDesktopBridge
  return { extensionConfigWriteV2, extensionSecretMutateBatchV2, ready: prepareExtensionHost(id) }
}

afterEach(() => { window.neoAnkiDesktop = undefined })

describe('host-rendered extension settings', () => {
  it('applies defaults without eager persistence, validates, and preserves unknown config keys', async () => {
    const id = 'org.neoanki.settings-form-one'
    const bridge = installBridge(id); await bridge.ready
    const { container } = render(<ExtensionSettingsForm manifest={manifest(id)}/>)
    expect(await screen.findByRole('checkbox', { name: /enable fixture/i })).not.toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Seconds' })).toHaveValue(30)
    expect(screen.queryByLabelText('Advanced detail')).not.toBeInTheDocument()
    expect(bridge.extensionConfigWriteV2).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'advanced')
    expect(screen.getByLabelText(/Advanced detail/)).toBeVisible()
    await userEvent.type(screen.getByLabelText(/Advanced detail/), 'Host validated')
    await userEvent.click(screen.getByRole('checkbox', { name: /enable fixture/i }))
    const seconds = screen.getByRole('spinbutton', { name: 'Seconds' })
    await userEvent.clear(seconds)
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('required')
    expect(bridge.extensionConfigWriteV2).not.toHaveBeenCalled()

    await userEvent.type(seconds, '25')
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(bridge.extensionConfigWriteV2).toHaveBeenCalled())
    expect(bridge.extensionConfigWriteV2.mock.calls[0][1]).toMatchObject({ enabled: true, seconds: 25, mode: 'advanced', advancedDetail: 'Host validated', unknown: 'preserved', profiles: [{ name: 'Primary' }] })
  })

  it('adds nested groups with stable ids and never reads credential plaintext', async () => {
    const id = 'org.neoanki.settings-form-two'
    const status = vi.fn(async () => ({ 'provider.key': false }))
    const bridge = installBridge(id, { extensionSecretStatusBatchV2: status }); await bridge.ready
    render(<ExtensionSettingsForm manifest={manifest(id)}/>)
    await screen.findByRole('checkbox', { name: /enable fixture/i })
    await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Move Profile 2 up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Profile 1' }))
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Add Profile' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Add Track' }).at(-1)!)
    expect(screen.getAllByRole('textbox', { name: 'Track name' })).toHaveLength(2)
    expect(status).toHaveBeenCalledWith(`token:${id}`, ['provider.key'])
    expect(window.neoAnkiDesktop?.extensionSecretReadBatchV2).toBeUndefined()

    const secret = screen.getByLabelText('API key')
    await userEvent.type(secret, 'device-only-value')
    await userEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(bridge.extensionSecretMutateBatchV2).toHaveBeenCalledWith(`token:${id}`, [{ op: 'set', key: 'provider.key', value: 'device-only-value' }]))
    expect(secret).toHaveValue('')
    expect(screen.getByText('Configured')).toBeVisible()
  })

  it('blocks in-app navigation while synchronized settings are dirty', async () => {
    const id = 'org.neoanki.settings-form-navigation'
    const bridge = installBridge(id); await bridge.ready
    render(<ExtensionSettingsForm manifest={manifest(id)}/>)
    await userEvent.click(await screen.findByRole('checkbox', { name: /enable fixture/i }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const event = new CustomEvent('neo-anki:before-navigate', { cancelable: true })
    expect(window.dispatchEvent(event)).toBe(false)
    expect(confirm).toHaveBeenCalledWith('Discard unsaved extension settings?')
    confirm.mockRestore()
  })

  it('keeps configuration usable when secure storage is unavailable and clears failed credential input', async () => {
    const id = 'org.neoanki.settings-form-secrets-unavailable'
    const bridge = installBridge(id, {
      extensionSecretStatusBatchV2: vi.fn(async () => { throw new Error('Secure storage unavailable.') }),
      extensionSecretMutateBatchV2: vi.fn(async () => { throw new Error('Secure storage unavailable.') }),
    }); await bridge.ready
    render(<ExtensionSettingsForm manifest={manifest(id)}/>)
    expect(await screen.findByRole('checkbox', { name: /enable fixture/i })).toBeVisible()
    expect(screen.getByText('Status unavailable')).toBeVisible()
    const secret = screen.getByLabelText('API key')
    await userEvent.type(secret, 'must-be-cleared')
    await userEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(secret).toHaveValue(''))
    expect(screen.getByText('Secure storage unavailable.')).toBeVisible()
  })

  it('keeps a failed synchronized draft available for retry or discard', async () => {
    const id = 'org.neoanki.settings-form-save-failure'
    const bridge = installBridge(id, { extensionConfigWriteV2: vi.fn(async () => { throw new Error('Atomic write failed.') }) }); await bridge.ready
    render(<ExtensionSettingsForm manifest={manifest(id)}/>)
    await userEvent.click(await screen.findByRole('checkbox', { name: /enable fixture/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Atomic write failed.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
  })
})
