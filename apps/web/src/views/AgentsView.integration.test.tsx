import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentConnection } from '../hooks/useAgentConnection'
import { fetchJson } from '../lib/api'
import { AgentsView } from './AgentsView'

vi.mock('../hooks/useAgentConnection', () => ({ useAgentConnection: vi.fn() }))
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), fetchJson: vi.fn() }))
const baseAgent = {
  id: 'alpha',
  name: 'Alpha',
  strategyId: 'balanced',
  running: false,
  pid: null,
  configPath: '/fixture/alpha.json',
  dataDir: '/fixture/alpha',
  ipcPort: 8766,
  startedAt: null,
}
const callbacks = {
  onCreate: vi.fn(),
  onStart: vi.fn(),
  onStop: vi.fn(),
  onSetStrategy: vi.fn(),
  onCreateStrategy: vi.fn(),
}
const props = {
  agents: [baseAgent],
  busy: {},
  strategies: [{ id: 'balanced' }, { id: 'conservative' }, { id: 'other' }],
  token: '',
  ...callbacks,
}
let renderer: ReactTestRenderer
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(useAgentConnection).mockReturnValue({
    status: 'idle',
    snapshot: null,
    lastHeartbeat: null,
    logs: [],
    chat: [],
    catalog: [],
    sendChat: vi.fn(),
  })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const button = (text: string) => renderer.root.findAllByType('button').find((b) => b.children.join('') === text)!
const selectTarget = async () => {
  await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'conservative' } }))
}
describe('strategy preview workflow regression', () => {
  it('cancels without writing configuration or controlling the agent', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({ result: { id: 'balanced', lpStrategy: 'spot' } })
      .mockResolvedValueOnce({ result: { id: 'conservative', lpStrategy: 'curve' } })
    await act(async () => {
      renderer = create(<AgentsView {...props} />)
    })
    await selectTarget()
    await act(async () => button('Preview changes').props.onClick())
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    await act(async () => button('Cancel').props.onClick())
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(callbacks.onSetStrategy).not.toHaveBeenCalled()
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onStop).not.toHaveBeenCalled()
  })
  it('discards delayed old preview after polling reports a new current strategy', async () => {
    const resolve: Array<(value: unknown) => void> = []
    vi.mocked(fetchJson).mockImplementation(() => new Promise((r) => resolve.push(r)) as never)
    await act(async () => {
      renderer = create(<AgentsView {...props} />)
    })
    await selectTarget()
    await act(async () => button('Preview changes').props.onClick())
    expect(resolve).toHaveLength(2)
    await act(async () => renderer.update(<AgentsView {...props} agents={[{ ...baseAgent, strategyId: 'other' }]} />))
    await act(async () => {
      resolve[0]!({ result: { id: 'balanced', lpStrategy: 'spot' } })
      resolve[1]!({ result: { id: 'conservative', lpStrategy: 'curve' } })
    })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(renderer.root.findByType('select').props.value).toBe('other')
    expect(callbacks.onSetStrategy).not.toHaveBeenCalled()
  })
  it('does not open any stream or show parent data on a stopped card', async () => {
    await act(async () => {
      renderer = create(<AgentsView {...props} />)
    })
    expect(useAgentConnection).toHaveBeenCalledWith(null, '', baseAgent.configPath, 'alpha')
    expect(JSON.stringify(renderer.toJSON())).toContain('No telemetry available for this agent.')
  })
})
