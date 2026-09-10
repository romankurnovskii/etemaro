/**
 * @file AgentSupervisor.test.ts
 * @description Unit tests for the agent control plane. Uses a temp repo root and
 * an injected spawn so no real child processes are launched.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSupervisor } from './AgentSupervisor.js'

function fakeChild() {
  const child: any = {
    pid: 4242,
    killed: false,
    exitCode: null,
    kill: vi.fn(() => {
      child.killed = true
    }),
    on: vi.fn(() => child),
  }
  return child
}

let repo: string
let spawnFn: ReturnType<typeof vi.fn>
let sup: AgentSupervisor

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'etemaro-sup-'))
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, 'config', 'user-config.json'),
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
    expect(fs.existsSync(path.join(repo, 'data', 'instances', 'sol-scalper'))).toBe(true)
  })

  it('assigns unique ids for duplicate names', () => {
    sup.create('Bot')
    expect(sup.create('Bot').id).toBe('bot-1')
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
    sup.stop('stopper')
    const child = spawnFn.mock.results[0]?.value
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
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
