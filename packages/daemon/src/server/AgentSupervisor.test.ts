/**
 * @file AgentSupervisor.test.ts
 * @description Unit tests for the agent control plane. Uses a temp repo root and
 * an injected spawn so no real child processes are launched.
 */

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSupervisor } from './AgentSupervisor.js'

// Supervisor only needs these two exports. Keep its real implementation under
// test without loading the core barrel's trading/network adapters or user config.
// The default config itself still comes from the production source of truth.
vi.mock('@etemaro/core', async () => {
  const { defaultAgentConfigStr } = await import('../../../core/src/config/defaultAgentConfig.js')
  const { tmpdir } = await import('node:os')
  return { defaultAgentConfigStr, REPO_ROOT: tmpdir() }
})

function fakeChild() {
  const child: any = Object.assign(new EventEmitter(), {
    pid: 4242,
    killed: false,
    exitCode: null,
    kill: vi.fn(() => {
      child.killed = true
    }),
  })
  return child
}

let repo: string
let spawnFn: ReturnType<typeof vi.fn>
let sup: AgentSupervisor

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-sup-'))
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, 'config', 'agent-config.json'),
    JSON.stringify({
      agentId: 'template',
      connection: { dryRun: false },
      strategy: { activeStrategyId: 'single_sided_reseed' },
    }),
  )
  spawnFn = vi.fn(() => fakeChild())
  sup = new AgentSupervisor({
    repoRoot: repo,
    spawnFn: spawnFn as any,
    cliInvocation: { program: 'node', argsPrefix: ['cli'] },
  })
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('AgentSupervisor', () => {
  it('creates a dry-run agent config and data dir', () => {
    const agent = sup.create('Sol Scalper')
    expect(agent.id).toBe('sol-scalper')
    expect(agent.name).toBe('Sol Scalper')
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'instances', 'sol-scalper.json'), 'utf8'))
    expect(cfg.agentId).toBe('sol-scalper')
    expect(cfg.connection.dryRun).toBe(true)
    expect(agent.ipcPort).toBe(cfg.connection.ipcPort)
    expect(agent.startedAt).toBeNull()
    expect(fs.existsSync(path.join(repo, 'data', 'instances', 'sol-scalper'))).toBe(true)
  })

  it('assigns unique ids for duplicate names', () => {
    sup.create('Bot')
    expect(sup.create('Bot').id).toBe('bot-1')
  })

  it('uses the real default config when no local template exists', async () => {
    fs.unlinkSync(path.join(repo, 'config', 'agent-config.json'))
    const { defaultAgentConfigStr } = await import('../../../core/src/config/defaultAgentConfig.js')
    const defaults = JSON.parse(defaultAgentConfigStr)
    const agent = sup.create('Defaulted')
    const cfg = sup.readConfigFile(agent.configPath)
    expect(cfg.strategy).toEqual(defaults.strategy)
    expect(cfg.connection).toEqual({ ...defaults.connection, dryRun: true, ipcPort: agent.ipcPort })
    expect(agent.startedAt).toBeNull()
  })

  it('lists agents sorted by name', () => {
    sup.create('Beta')
    sup.create('Alpha')
    expect(sup.list().map((a) => a.id)).toEqual(['alpha', 'beta'])
  })

  it('starts an agent via the CLI and marks it running', () => {
    sup.create('Runner')
    const agent = sup.start('runner')
    expect(spawnFn).toHaveBeenCalledOnce()
    const [program, args] = spawnFn.mock.calls[0] as [string, string[]]
    expect(program).toBe('node')
    expect(args).toContain('start')
    expect(args).toContain('--config')
    expect(args).toContain('--data-dir')
    expect(agent.running).toBe(true)
    expect(agent.pid).toBe(4242)
  })

  it('stops a running agent with SIGTERM', () => {
    sup.create('Stopper')
    sup.start('stopper')
    const stopped = sup.stop('stopper')
    const child = spawnFn.mock.results[0]?.value
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(stopped.startedAt).toBeNull()
  })

  it('exposes the configured IPC port without inventing a port for older configs', () => {
    const agent = sup.create('Telemetry')
    const cfg = sup.readConfigFile(agent.configPath)
    expect(sup.writeConfigFile(agent.configPath, { ...cfg, connection: { ipcPort: 9007 } }).ipcPort).toBe(9007)
    expect(sup.list()[0]?.ipcPort).toBe(9007)
    expect(sup.writeConfigFile(agent.configPath, { ...cfg, connection: {} }).ipcPort).toBeNull()
  })

  it('does not advertise TCP when a configured Unix socket takes precedence', () => {
    const agent = sup.create('Socket agent')
    const cfg = sup.readConfigFile(agent.configPath)
    const socketPath = path.join(repo, 'data', 'agent.sock')
    expect(
      sup.writeConfigFile(agent.configPath, {
        ...cfg,
        connection: { ipcPort: 9007, ipcSocketPath: socketPath },
      }).ipcPort,
    ).toBeNull()
    expect(sup.list()[0]?.ipcPort).toBeNull()
    expect(
      sup.writeConfigFile(agent.configPath, {
        ...cfg,
        connection: { ipcPort: 9007, ipcSocketPath: '' },
      }).ipcPort,
    ).toBe(9007)
    expect(
      sup.writeConfigFile(agent.configPath, {
        ...cfg,
        connection: { ipcPort: 9007 },
      }).ipcPort,
    ).toBe(9007)
  })

  it.each([0, -1, 65536, 8766.5, '8766', null])('does not expose an invalid IPC port %s', (ipcPort) => {
    const agent = sup.create('Invalid port')
    const cfg = sup.readConfigFile(agent.configPath)
    const updated = sup.writeConfigFile(agent.configPath, { ...cfg, connection: { ipcPort } })
    expect(updated.ipcPort).toBeNull()
  })

  it('records the actual child start time and preserves it on an idempotent start', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T01:00:00.000Z'))
    sup.create('Timed')
    expect(sup.start('timed').startedAt).toBe('2026-10-17T01:00:00.000Z')
    vi.setSystemTime(new Date('2026-10-17T01:00:30.000Z'))
    expect(sup.start('timed').startedAt).toBe('2026-10-17T01:00:00.000Z')
    expect(sup.list()[0]?.startedAt).toBe('2026-10-17T01:00:00.000Z')
    expect(spawnFn).toHaveBeenCalledOnce()
  })

  it('clears the start time when the current child exits', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T01:00:00.000Z'))
    sup.create('Exiting')
    sup.start('exiting')
    const child = spawnFn.mock.results[0]?.value
    child.exitCode = 0
    child.emit('exit', 0)
    expect(sup.list()[0]).toMatchObject({ running: false, pid: null, startedAt: null })
  })

  it('uses a fresh timestamp after restart and ignores the old child exit', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T01:00:00.000Z'))
    sup.create('Restarted')
    sup.start('restarted')
    const oldChild = spawnFn.mock.results[0]?.value
    expect(sup.stop('restarted').startedAt).toBeNull()
    vi.setSystemTime(new Date('2026-10-17T01:02:00.000Z'))
    expect(sup.start('restarted').startedAt).toBe('2026-10-17T01:02:00.000Z')
    const newChild = spawnFn.mock.results[1]?.value
    oldChild.exitCode = 0
    oldChild.emit('exit', 0)
    expect(sup.list()[0]).toMatchObject({ running: true, startedAt: '2026-10-17T01:02:00.000Z' })
    expect(sup.runningChildren()).toEqual([{ id: 'restarted', pid: newChild.pid }])
    // Exercise normal replacement exit as well, including descriptor cleanup.
    newChild.exitCode = 0
    newChild.emit('exit', 0)
    expect(sup.list()[0]?.startedAt).toBeNull()
  })

  it('setStrategy updates the instance config', () => {
    sup.create('Strategist')
    expect(sup.setStrategy('strategist', 'fee_compounding').strategyId).toBe('fee_compounding')
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'instances', 'strategist.json'), 'utf8'))
    expect(cfg.strategy.activeStrategyId).toBe('fee_compounding')
  })

  it('reads and writes an instance config by path', () => {
    sup.create('Configurable')
    const configPath = path.join(repo, 'config', 'instances', 'configurable.json')
    expect(sup.readConfigFile(configPath).agentId).toBe('configurable')
    const updated = { ...sup.readConfigFile(configPath), risk: { maxPositions: 3 } }
    expect(sup.writeConfigFile(configPath, updated).id).toBe('configurable')
    expect(sup.readConfigFile(configPath).risk).toEqual({ maxPositions: 3 })
  })

  it('rejects config paths outside config/instances', () => {
    expect(() => sup.readConfigFile('/etc/passwd')).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'data', 'x.json'))).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'config', 'instances', '..', 'evil.json'))).toThrow()
    expect(() => sup.writeConfigFile(path.join(repo, 'config', 'users.json'), {})).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'config', 'instances', 'x.txt'))).toThrow(/config\/instances/)
  })

  it('rejects non-object config content', () => {
    sup.create('Guard')
    const configPath = path.join(repo, 'config', 'instances', 'guard.json')
    expect(() => sup.writeConfigFile(configPath, 'nope')).toThrow(/JSON object/)
  })

  it('rejects path traversal ids', () => {
    expect(() => sup.start('../evil')).toThrow(/Invalid agent id/)
    expect(() => sup.start('a/b')).toThrow(/Invalid agent id/)
  })

  it('throws for a missing agent', () => {
    expect(() => sup.start('nope')).toThrow(/not found/)
  })

  it('records spawned pids in data/agents.runtime.json', () => {
    sup.create('Runner')
    sup.start('runner')
    const reg = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'agents.runtime.json'), 'utf8'))
    expect(reg).toHaveLength(1)
    expect(reg[0].id).toBe('runner')
  })

  it('stopAll terminates every tracked child', () => {
    sup.create('Alpha')
    sup.create('Beta')
    sup.start('alpha')
    sup.start('beta')
    expect(sup.stopAll()).toBe(2)
    expect(spawnFn.mock.results[0]?.value.kill).toHaveBeenCalledWith('SIGTERM')
    expect(spawnFn.mock.results[1]?.value.kill).toHaveBeenCalledWith('SIGTERM')
    expect(fs.existsSync(path.join(repo, 'data', 'agents.runtime.json'))).toBe(false)
    expect(sup.list().every((agent) => agent.startedAt === null)).toBe(true)
  })

  it('reapOrphans kills registered agent pids and clears the registry', () => {
    const reg = path.join(repo, 'data', 'agents.runtime.json')
    fs.mkdirSync(path.dirname(reg), { recursive: true })
    fs.writeFileSync(reg, JSON.stringify([{ id: 'x', pid: 4242 }]))
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      expect(sup.reapOrphans(() => true)).toBe(1)
      expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM')
      expect(fs.existsSync(reg)).toBe(false)
    } finally {
      killSpy.mockRestore()
    }
  })

  it('reapOrphans ignores pids that are not agent processes', () => {
    const reg = path.join(repo, 'data', 'agents.runtime.json')
    fs.mkdirSync(path.dirname(reg), { recursive: true })
    fs.writeFileSync(reg, JSON.stringify([{ id: 'x', pid: 4242 }]))
    expect(sup.reapOrphans(() => false)).toBe(0)
  })
})
