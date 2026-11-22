/**
 * @file AgentSupervisor.ts
 * @description Manages Etemaro agent instances (config/instances/*.json) as child
 * processes so the browser console can create, start, stop, and re-target agents
 * without a terminal. Reuses the CLI `start --config --data-dir` contract already
 * used by the desktop app and PM2 multi-agent setups.
 *
 * @pattern Reuses the instance-config layout produced by `etemaro new-agent`.
 * @dependencies node:child_process, @etemaro/core (REPO_ROOT, defaultAgentConfigStr)
 */

import { type ChildProcess, execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { defaultAgentConfigStr, REPO_ROOT } from '@etemaro/core'

export interface ManagedAgent {
  id: string
  name: string
  description?: string
  strategyId: string | null
  running: boolean
  pid: number | null
  configPath: string
  dataDir: string
  /** False when the instance config does not set `connection.dryRun: true`. */
  dryRun: boolean
}

export interface AgentSupervisorOptions {
  /** Monorepo root. Defaults to the resolved REPO_ROOT. */
  repoRoot?: string
  /** Injectable spawn for tests. */
  spawnFn?: typeof spawn
  /** How to launch the CLI. Detected from process.argv by default. */
  cliInvocation?: { program: string; argsPrefix: string[] }
}

interface InstanceConfig {
  agentId?: string
  description?: string
  strategy?: { activeStrategyId?: string; [key: string]: unknown }
  connection?: { dryRun?: boolean; [key: string]: unknown }
  [key: string]: unknown
}

const ID_PATTERN = /^[a-zA-Z0-9._-]+$/

/** Port the console daemon binds itself. Agents must never take it. */
const CONSOLE_IPC_PORT = 8765
const AGENT_PORT_RANGE_START = 8766
const AGENT_PORT_RANGE_END = 8865
/** How long to wait for SIGTERM before escalating to SIGKILL. */
const STOP_TIMEOUT_MS = 5_000

/**
 * Resolve `connection.dryRun`, which the schema allows to be a literal boolean
 * or an `env.NAME` indirection. Anything other than an explicit true is live.
 */
function resolveDryRun(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string' && value.startsWith('env.')) {
    const resolved = process.env[value.slice(4)]
    return resolved === 'true' || resolved === '1'
  }
  return false
}

/** True when nothing is listening on `port` on loopback. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** Best-effort check that a PID is an Etemaro agent process (guards against PID reuse). */
function defaultIsAgentProcess(pid: number): boolean {
  const pattern = /Cli\.(ts|cjs)|Daemon\.(ts|js)|etemaro/
  try {
    if (process.platform === 'linux') {
      return pattern.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'))
    }
    return pattern.test(execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' }))
  } catch {
    return false
  }
}

export class AgentSupervisor {
  private readonly repoRoot: string
  private readonly spawnFn: typeof spawn
  private readonly cli: { program: string; argsPrefix: string[] }
  private readonly children = new Map<string, ChildProcess>()

  constructor(options: AgentSupervisorOptions = {}) {
    this.repoRoot = options.repoRoot ?? REPO_ROOT
    this.spawnFn = options.spawnFn ?? spawn
    this.cli = options.cliInvocation ?? AgentSupervisor.resolveCliInvocation()
  }

  /** Launch the current CLI entrypoint (tsx in dev, bundled .cjs in production). */
  static resolveCliInvocation(): { program: string; argsPrefix: string[] } {
    const entry = process.argv[1] ?? ''
    if (entry.endsWith('.ts')) {
      return { program: process.execPath, argsPrefix: ['--import', 'tsx', entry] }
    }
    if (entry) return { program: process.execPath, argsPrefix: [entry] }
    return { program: 'etemaro', argsPrefix: [] }
  }

  /** All configured agents with live running state. */
  list(): ManagedAgent[] {
    const dir = this.instancesDir()
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.json') && !file.endsWith('.bak'))
      .map((file) => this.toManaged(path.basename(file, '.json')))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Create a new agent instance config (dry-run by default) and its data dir. */
  async create(rawName: string): Promise<ManagedAgent> {
    const name = String(rawName ?? '').trim()
    if (!name) throw new Error('Agent name is required')
    const id = this.uniqueId(this.slug(name))
    const config = this.loadTemplate()
    config.agentId = id
    config.description = name
    config.connection = { ...(config.connection ?? {}), dryRun: true, ipcPort: await this.allocatePort() }
    fs.mkdirSync(this.instancesDir(), { recursive: true })
    fs.writeFileSync(this.configPathFor(id), `${JSON.stringify(config, null, 2)}\n`)
    fs.mkdirSync(this.dataDirFor(id), { recursive: true })
    return this.toManaged(id)
  }

  /** Spawn the agent as a child process. No-op when already running. */
  async start(id: string): Promise<ManagedAgent> {
    const agentId = this.safeId(id)
    const configPath = this.configPathFor(agentId)
    if (!fs.existsSync(configPath)) throw new Error(`Agent "${agentId}" not found`)
    if (this.isRunning(agentId)) return this.toManaged(agentId)

    // The child's IPC server must bind a port of its own: without one it falls
    // back to the console daemon's port and dies with EADDRINUSE, leaving the
    // agent running headless with no telemetry.
    await this.ensureIpcPort(agentId)

    const dataDir = this.dataDirFor(agentId)
    const baseDataDir = path.join(this.repoRoot, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    const out = fs.openSync(path.join(dataDir, 'agent.out'), 'a')
    // --data-dir is the base dir; core isolates to instances/<id> via dataPath().
    const args = [...this.cli.argsPrefix, 'start', '--config', configPath, '--data-dir', baseDataDir]
    let child: ChildProcess
    try {
      child = this.spawnFn(this.cli.program, args, {
        cwd: this.repoRoot,
        env: {
          ...process.env,
          AGENT_CONFIG_PATH: configPath,
          // Base data dir only — core appends instances/<id> via dataPath().
          ETEMARO_DATA_DIR: path.join(this.repoRoot, 'data'),
          ETEMARO_INSTANCE_ID: agentId,
        },
        stdio: ['ignore', out, out],
        detached: false,
      })
    } catch (err) {
      // Do not leak the log fd when the spawn itself fails.
      try {
        fs.closeSync(out)
      } catch {
        /* ignore */
      }
      throw err
    }
    this.children.set(agentId, child)
    this.writeRegistry()
    child.on('exit', () => {
      this.children.delete(agentId)
      this.writeRegistry()
      try {
        fs.closeSync(out)
      } catch {
        /* ignore */
      }
    })
    return this.toManaged(agentId)
  }

  /**
   * Terminate the agent child process and wait for it to exit, so the caller
   * never reports a stale `running: true`. Escalates to SIGKILL after
   * `STOP_TIMEOUT_MS` when the child ignores SIGTERM.
   */
  async stop(id: string): Promise<ManagedAgent> {
    const agentId = this.safeId(id)
    const child = this.children.get(agentId)
    if (child && child.exitCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* already gone */
          }
          resolve()
        }, STOP_TIMEOUT_MS)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    return this.toManaged(agentId)
  }

  /** Point an agent at a different strategy id. */
  setStrategy(id: string, strategyId: string): ManagedAgent {
    const agentId = this.safeId(id)
    const target = String(strategyId ?? '').trim()
    if (!target) throw new Error('strategyId is required')
    if (!fs.existsSync(this.configPathFor(agentId))) throw new Error(`Agent "${agentId}" not found`)
    const config = this.readConfig(agentId)
    config.strategy = { ...(config.strategy ?? {}), activeStrategyId: target }
    fs.writeFileSync(this.configPathFor(agentId), `${JSON.stringify(config, null, 2)}\n`)
    return this.toManaged(agentId)
  }

  /** Terminate every tracked agent child. Called on daemon shutdown. */
  stopAll(): number {
    let stopped = 0
    for (const [id, child] of this.children) {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM')
          stopped++
        } catch {
          /* ignore */
        }
      }
      this.children.delete(id)
    }
    this.clearRegistry()
    return stopped
  }

  /** Kill agent children left behind by a previous run (PID file is cleared on clean exit). */
  reapOrphans(isAgentProcess: (pid: number) => boolean = defaultIsAgentProcess): number {
    const entries = this.readRegistry()
    if (!entries.length) return 0
    let killed = 0
    for (const entry of entries) {
      if (!entry.pid || entry.pid === process.pid) continue
      if (!isAgentProcess(entry.pid)) continue
      try {
        process.kill(entry.pid, 'SIGTERM')
        killed++
      } catch {
        /* already gone */
      }
    }
    this.clearRegistry()
    return killed
  }

  /** Children spawned by this supervisor process. */
  runningChildren(): Array<{ id: string; pid: number | null }> {
    return [...this.children.entries()].map(([id, child]) => ({ id, pid: child.pid ?? null }))
  }

  private registryFile(): string {
    return path.join(this.repoRoot, 'data', 'agents.runtime.json')
  }

  private writeRegistry(): void {
    try {
      const entries = this.runningChildren().filter((c) => c.pid)
      fs.mkdirSync(path.dirname(this.registryFile()), { recursive: true })
      fs.writeFileSync(this.registryFile(), `${JSON.stringify(entries, null, 2)}\n`)
    } catch {
      /* best-effort */
    }
  }

  private readRegistry(): Array<{ id: string; pid: number }> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile(), 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private clearRegistry(): void {
    try {
      fs.unlinkSync(this.registryFile())
    } catch {
      /* ignore */
    }
  }

  /** Whether an agent child process is currently alive. */
  isRunning(id: string): boolean {
    const child = this.children.get(id)
    return Boolean(child && child.exitCode === null && !child.killed)
  }

  /**
   * Read an instance config by absolute path. The path must resolve to a `.json`
   * file directly inside `config/instances/` — anything else is rejected, so a
   * client can never read arbitrary files through the API.
   */
  readConfigFile(configPath: string): Record<string, unknown> {
    const id = this.idFromConfigPath(configPath)
    return this.readConfig(id) as Record<string, unknown>
  }

  /** Overwrite an instance config by absolute path (same guard as readConfigFile). */
  writeConfigFile(configPath: string, content: unknown): ManagedAgent {
    const id = this.idFromConfigPath(configPath)
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new Error('Config content must be a JSON object')
    }
    fs.writeFileSync(this.configPathFor(id), `${JSON.stringify(content, null, 2)}\n`)
    return this.toManaged(id)
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** Resolve a client-supplied path to a safe instance id, or throw. */
  private idFromConfigPath(configPath: string): string {
    const instancesDir = path.resolve(this.instancesDir())
    const resolved = path.resolve(String(configPath ?? ''))
    if (path.dirname(resolved) !== instancesDir || !resolved.endsWith('.json')) {
      throw new Error('Config path must be a .json file under config/instances')
    }
    return this.safeId(path.basename(resolved, '.json'))
  }

  private instancesDir(): string {
    return path.join(this.repoRoot, 'config', 'instances')
  }

  private configPathFor(id: string): string {
    return path.join(this.instancesDir(), `${id}.json`)
  }

  private dataDirFor(id: string): string {
    return path.join(this.repoRoot, 'data', 'instances', id)
  }

  private toManaged(id: string): ManagedAgent {
    const config = this.readConfig(id, true)
    const child = this.children.get(id)
    const running = Boolean(child && child.exitCode === null && !child.killed)
    return {
      id,
      name: config.description || config.agentId || id,
      description: config.description,
      strategyId: config.strategy?.activeStrategyId ?? null,
      running,
      pid: running ? (child?.pid ?? null) : null,
      configPath: this.configPathFor(id),
      dataDir: this.dataDirFor(id),
      dryRun: resolveDryRun(config.connection?.dryRun),
    }
  }

  private readConfig(id: string, tolerateMissing = false): InstanceConfig {
    try {
      return JSON.parse(fs.readFileSync(this.configPathFor(id), 'utf8')) as InstanceConfig
    } catch (err) {
      if (tolerateMissing) return {}
      throw err
    }
  }

  private loadTemplate(): InstanceConfig {
    const templatePath = path.join(this.repoRoot, 'config', 'agent-config.json')
    try {
      if (fs.existsSync(templatePath)) {
        return JSON.parse(fs.readFileSync(templatePath, 'utf8')) as InstanceConfig
      }
    } catch {
      /* fall through to defaults */
    }
    return JSON.parse(defaultAgentConfigStr) as InstanceConfig
  }

  private safeId(id: string): string {
    const value = String(id ?? '').trim()
    if (!value || !ID_PATTERN.test(value) || value.includes('..')) {
      throw new Error(`Invalid agent id: "${value}"`)
    }
    return value
  }

  private slug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /** Ports already claimed by other instance configs (running or not). */
  private claimedPorts(exceptId: string): Set<number> {
    const claimed = new Set<number>()
    for (const agent of this.list()) {
      if (agent.id === exceptId) continue
      const port = Number(this.readConfig(agent.id, true).connection?.ipcPort)
      if (Number.isInteger(port) && port > 0) claimed.add(port)
    }
    return claimed
  }

  /** First port in the agent range that is unclaimed and actually bindable. */
  private async allocatePort(exceptId = ''): Promise<number> {
    const claimed = this.claimedPorts(exceptId)
    for (let port = AGENT_PORT_RANGE_START; port <= AGENT_PORT_RANGE_END; port++) {
      if (port === CONSOLE_IPC_PORT || claimed.has(port)) continue
      if (await isPortFree(port)) return port
    }
    throw new Error(`No free IPC port in ${AGENT_PORT_RANGE_START}-${AGENT_PORT_RANGE_END}`)
  }

  /**
   * Guarantee the instance config has a usable `connection.ipcPort` before the
   * child spawns, and persist it. A missing port, the console port, a port
   * claimed by another instance, or a port already bound all trigger a
   * reallocation.
   */
  private async ensureIpcPort(agentId: string): Promise<number> {
    const config = this.readConfig(agentId)
    const configured = Number(config.connection?.ipcPort)
    const usable =
      Number.isInteger(configured) &&
      configured > 0 &&
      configured !== CONSOLE_IPC_PORT &&
      !this.claimedPorts(agentId).has(configured) &&
      (await isPortFree(configured))

    if (usable) return configured

    const port = await this.allocatePort(agentId)
    config.connection = { ...(config.connection ?? {}), ipcPort: port }
    fs.writeFileSync(this.configPathFor(agentId), `${JSON.stringify(config, null, 2)}\n`)
    return port
  }

  private uniqueId(base: string): string {
    const seed = base || 'agent'
    let candidate = seed
    let counter = 1
    while (fs.existsSync(this.configPathFor(candidate))) {
      candidate = `${seed}-${counter}`
      counter += 1
    }
    return candidate
  }
}
