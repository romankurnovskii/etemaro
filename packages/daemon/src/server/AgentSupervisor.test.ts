/**
 * @file AgentSupervisor.test.ts
 * @description Unit tests for the agent control plane. Uses a temp repo root and
 * an injected spawn so no real child processes are launched.
 */

import fs from 'node:fs'
import net from 'node:net'
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

/** Bind a real loopback port so `isPortFree` sees it as taken. */
function occupy(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

let repo: string
let spawnFn: ReturnType<typeof vi.fn>
let sup: AgentSupervisor

function writeInstance(id: string, connection: Record<string, unknown>): void {
  const dir = path.join(repo, 'config', 'instances')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({ agentId: id, connection, strategy: { activeStrategyId: 'spot' } }),
  )
}

function readInstance(id: string): any {
  return JSON.parse(fs.readFileSync(path.join(repo, 'config', 'instances', `${id}.json`), 'utf8'))
}

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
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('AgentSupervisor', () => {
  it('creates a dry-run agent config and data dir', async () => {
    const agent = await sup.create('Sol Scalper')
    expect(agent.id).toBe('sol-scalper')
    expect(agent.name).toBe('Sol Scalper')
    expect(agent.dryRun).toBe(true)
    const cfg = readInstance('sol-scalper')
    expect(cfg.agentId).toBe('sol-scalper')
    expect(cfg.connection.dryRun).toBe(true)
    expect(fs.existsSync(path.join(repo, 'data', 'instances', 'sol-scalper'))).toBe(true)
  })

  it('assigns unique ids for duplicate names', async () => {
    await sup.create('Bot')
    expect((await sup.create('Bot')).id).toBe('bot-1')
  })

  it('lists agents sorted by name', async () => {
    await sup.create('Beta')
    await sup.create('Alpha')
    expect(sup.list().map((a) => a.id)).toEqual(['alpha', 'beta'])
  })

  it('starts an agent via the CLI and marks it running', async () => {
    await sup.create('Runner')
    const agent = await sup.start('runner')
    expect(spawnFn).toHaveBeenCalledOnce()
    const [program, args] = spawnFn.mock.calls[0] as [string, string[]]
    expect(program).toBe('node')
    expect(args).toContain('start')
    expect(args).toContain('--config')
    expect(args).toContain('--data-dir')
    expect(agent.running).toBe(true)
    expect(agent.pid).toBe(4242)
  })

  it('stops a running agent with SIGTERM', async () => {
    await sup.create('Stopper')
    await sup.start('stopper')
    sup.stop('stopper')
    const child = spawnFn.mock.results[0]?.value
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('setStrategy updates the instance config', async () => {
    await sup.create('Strategist')
    expect(sup.setStrategy('strategist', 'fee_compounding').strategyId).toBe('fee_compounding')
    expect(readInstance('strategist').strategy.activeStrategyId).toBe('fee_compounding')
  })

  it('reads and writes an instance config by path', async () => {
    await sup.create('Configurable')
    const configPath = path.join(repo, 'config', 'instances', 'configurable.json')
    expect(sup.readConfigFile(configPath).agentId).toBe('configurable')
    const updated = { ...sup.readConfigFile(configPath), risk: { maxPositions: 3 } }
    expect(sup.writeConfigFile(configPath, updated).id).toBe('configurable')
    expect(sup.readConfigFile(configPath).risk).toEqual({ maxPositions: 3 })
  })

  it('rejects config paths outside config/instances', async () => {
    expect(() => sup.readConfigFile('/etc/passwd')).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'data', 'x.json'))).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'config', 'instances', '..', 'evil.json'))).toThrow()
    expect(() => sup.writeConfigFile(path.join(repo, 'config', 'users.json'), {})).toThrow(/config\/instances/)
    expect(() => sup.readConfigFile(path.join(repo, 'config', 'instances', 'x.txt'))).toThrow(/config\/instances/)
  })

  it('rejects non-object config content', async () => {
    await sup.create('Guard')
    const configPath = path.join(repo, 'config', 'instances', 'guard.json')
    expect(() => sup.writeConfigFile(configPath, 'nope')).toThrow(/JSON object/)
  })

  it('rejects path traversal ids', async () => {
    await expect(sup.start('../evil')).rejects.toThrow(/Invalid agent id/)
    await expect(sup.start('a/b')).rejects.toThrow(/Invalid agent id/)
  })

  it('throws for a missing agent', async () => {
    await expect(sup.start('nope')).rejects.toThrow(/not found/)
  })

  it('records spawned pids in data/agents.runtime.json', async () => {
    await sup.create('Runner')
    await sup.start('runner')
    const reg = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'agents.runtime.json'), 'utf8'))
    expect(reg).toHaveLength(1)
    expect(reg[0].id).toBe('runner')
  })

  it('stopAll terminates every tracked child', async () => {
    await sup.create('Alpha')
    await sup.create('Beta')
    await sup.start('alpha')
    await sup.start('beta')
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

describe('AgentSupervisor IPC port allocation', () => {
  it('assigns a free port on start when the config has none', async () => {
    writeInstance('legacy', { dryRun: true })
    await sup.start('legacy')
    const port = readInstance('legacy').connection.ipcPort
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThanOrEqual(8766)
  })

  it('never assigns the console daemon port 8765', async () => {
    writeInstance('legacy', { dryRun: true })
    await sup.start('legacy')
    expect(readInstance('legacy').connection.ipcPort).not.toBe(8765)
  })

  it('keeps a configured port that is free and unclaimed', async () => {
    writeInstance('pinned', { dryRun: true, ipcPort: 8801 })
    await sup.start('pinned')
    expect(readInstance('pinned').connection.ipcPort).toBe(8801)
  })

  it('reallocates when the configured port is the console port', async () => {
    writeInstance('collides', { dryRun: true, ipcPort: 8765 })
    await sup.start('collides')
    expect(readInstance('collides').connection.ipcPort).not.toBe(8765)
  })

  it('reallocates when another instance already claims the port', async () => {
    writeInstance('first', { dryRun: true, ipcPort: 8802 })
    writeInstance('second', { dryRun: true, ipcPort: 8802 })
    await sup.start('second')
    expect(readInstance('second').connection.ipcPort).not.toBe(8802)
  })

  it('reallocates when the configured port is already bound', async () => {
    const server = await occupy(8803)
    try {
      writeInstance('busy', { dryRun: true, ipcPort: 8803 })
      await sup.start('busy')
      expect(readInstance('busy').connection.ipcPort).not.toBe(8803)
    } finally {
      await close(server)
    }
  })

  it('gives two agents distinct ports', async () => {
    await sup.create('One')
    await sup.create('Two')
    const a = readInstance('one').connection.ipcPort
    const b = readInstance('two').connection.ipcPort
    expect(a).not.toBe(b)
  })

  it('reports dryRun per agent', async () => {
    await sup.create('Dry')
    writeInstance('live', { dryRun: false })
    const byId = Object.fromEntries(sup.list().map((a) => [a.id, a.dryRun]))
    expect(byId.dry).toBe(true)
    expect(byId.live).toBe(false)
  })
})
