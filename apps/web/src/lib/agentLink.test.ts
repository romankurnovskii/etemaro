import { describe, expect, it } from 'vitest'
import { resolveAgentEndpoint } from './agentLink'

describe('resolveAgentEndpoint', () => {
  it('uses the agent config port on the daemon host', () => {
    const ep = resolveAgentEndpoint({ connection: { ipcPort: 8766 } }, 'http://127.0.0.1:8765', 'tok')
    expect(ep).toEqual({ ok: true, url: 'ws://127.0.0.1:8766', token: 'tok' })
  })

  it('prefers the agent config token over the console token', () => {
    const ep = resolveAgentEndpoint({ connection: { ipcPort: 8767, ipcToken: 'own' } }, 'http://localhost:8765', 'tok')
    expect(ep).toMatchObject({ ok: true, token: 'own' })
  })

  it('uses wss for https daemons', () => {
    const ep = resolveAgentEndpoint({ connection: { ipcPort: 9000 } }, 'https://box.local', '')
    expect(ep).toMatchObject({ ok: true, url: 'wss://box.local:9000' })
  })

  it('fails clearly without a port or with a unix socket', () => {
    expect(resolveAgentEndpoint({}, 'http://127.0.0.1:8765', '')).toMatchObject({ ok: false })
    expect(resolveAgentEndpoint(null, 'http://127.0.0.1:8765', '')).toMatchObject({ ok: false })
    expect(
      resolveAgentEndpoint({ connection: { ipcPort: 8766, ipcSocketPath: '/tmp/a.sock' } }, 'http://x', ''),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/Unix socket/) })
  })
})
