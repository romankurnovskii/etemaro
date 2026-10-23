import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { endpointLabel, readInitialToken, TokenControls } from './App'
import { useAgentConnection } from './hooks/useAgentConnection'
import { useAgents } from './hooks/useAgents'
import { useStrategies } from './hooks/useStrategies'

vi.mock('./hooks/useAgentConnection', () => ({ useAgentConnection: vi.fn() }))
vi.mock('./hooks/useAgents', () => ({ useAgents: vi.fn() }))
vi.mock('./hooks/useStrategies', () => ({ useStrategies: vi.fn() }))

let renderer: ReactTestRenderer | undefined
let storage: {
  getItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
  removeItem: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn() }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { search: '', href: 'https://console.test/?view=agents#main' })
  vi.stubGlobal('history', { state: null, replaceState: vi.fn() })
  vi.mocked(useAgentConnection).mockReturnValue({
    status: 'idle',
    snapshot: null,
    lastHeartbeat: null,
    logs: [],
    chat: [],
    catalog: [],
    sendChat: vi.fn(),
  })
  vi.mocked(useAgents).mockReturnValue({
    agents: [],
    busy: {},
    loading: false,
    error: null,
    create: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setStrategy: vi.fn(),
    reload: vi.fn(),
  })
  vi.mocked(useStrategies).mockReturnValue({ strategies: [], reload: vi.fn() })
})
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer?.unmount()
    })
  renderer = undefined
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('explicit token management', () => {
  it('imports a legacy URL token for the session without automatically saving it, and removes it from the address bar', async () => {
    vi.stubGlobal('location', {
      search: '?token=fixture-token&view=agents',
      href: 'https://console.test/?token=fixture-token&view=agents#main',
    })
    await act(async () => {
      renderer = create(createElement(App))
    })
    expect(useAgentConnection).toHaveBeenCalledWith(expect.any(String), 'fixture-token')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=agents#main')
  })
  it('uses an existing saved token without writing it again, and tolerates unavailable browser storage', () => {
    storage.getItem.mockReturnValue('fixture-token')
    expect(readInitialToken()).toBe('fixture-token')
    expect(storage.setItem).not.toHaveBeenCalled()
    storage.getItem.mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    expect(readInitialToken()).toBe('')
  })
  it('saves only on explicit opt-in submission and clears storage when choosing session-only use', async () => {
    const apply = vi.fn()
    await act(async () => {
      renderer = create(createElement(TokenControls, { token: '', onApply: apply }))
    })
    const root = renderer!.root
    await act(async () =>
      root.findByProps({ id: 'console-access-token' }).props.onChange({ target: { value: 'fixture-token' } }),
    )
    expect(storage.setItem).not.toHaveBeenCalled()
    await act(async () => root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(storage.setItem).toHaveBeenCalledWith('etemaro.token', 'fixture-token')
    expect(apply).toHaveBeenLastCalledWith('fixture-token')
    expect(root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
    await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }))
    expect(storage.removeItem).toHaveBeenCalledWith('etemaro.token')
  })
  it('clears the in-memory credential even when browser storage refuses removal, without echoing it in the notice', async () => {
    const apply = vi.fn()
    storage.removeItem.mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    await act(async () => {
      renderer = create(createElement(TokenControls, { token: 'fixture-token', onApply: apply }))
    })
    await act(async () =>
      renderer!.root
        .findAllByType('button')
        .find((b) => b.children.join('') === 'Clear token')!
        .props.onClick(),
    )
    expect(apply).toHaveBeenCalledWith('')
    const notice = renderer!.root.findByProps({ role: 'status' }).children.join('')
    expect(notice).toContain('browser storage could not be updated')
    expect(notice).not.toContain('fixture-token')
  })
  it('reconnects all token consumers after an explicit update', async () => {
    await act(async () => {
      renderer = create(createElement(App))
    })
    await act(async () =>
      renderer!.root.findByProps({ id: 'console-access-token' }).props.onChange({ target: { value: 'fixture-token' } }),
    )
    await act(async () =>
      renderer!.root.findByProps({ className: 'console-token-panel' }).props.onSubmit({ preventDefault() {} }),
    )
    expect(useAgentConnection).toHaveBeenLastCalledWith(expect.any(String), 'fixture-token')
    expect(useAgents).toHaveBeenLastCalledWith('fixture-token')
    expect(useStrategies).toHaveBeenLastCalledWith('fixture-token')
  })
  it('does not display URL credentials, query tokens or fragments in the endpoint label', () => {
    expect(
      endpointLabel('https://fixture-user:fixture-token@daemon.test:8765/console?token=fixture-token#private'),
    ).toBe('https://daemon.test:8765/console')
    expect(endpointLabel('not a URL')).toBe('Daemon endpoint')
  })
})
