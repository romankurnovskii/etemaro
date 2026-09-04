/**
 * First-run operator setup: create runtime dirs, check the two keys needed
 * for dry-run, print a short next command. Jupiter is live-only.
 */

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

export interface SetupStatus {
  llm: boolean
  jupiter: boolean
  readyForDryRun: boolean
  readyForLive: boolean
}

export interface SkeletonResult {
  directory: string
  env: { path: string; created: boolean }
  config: { path: string; created: boolean }
  strategyLibrary: { path: string; created: boolean }
}

const ENV_TEMPLATE = `# etemaro — first-run environment
LLM_API_KEY=""
LLM_BASE_URL="https://openrouter.ai/api/v1"
LLM_MODEL="anthropic/claude-3.5-sonnet"
JUPITER_API_KEY=""
HELIUS_API_KEY=""
RPC_URL="https://pump.helius-rpc.com"
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
TELEGRAM_ALLOWED_USER_IDS=""
`

function present(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().replace(/^["']|["']$/g, '')
  if (!v) return false
  if (v.startsWith('env.')) return false
  return true
}

export function assessSetup(env: NodeJS.Dict<string>): SetupStatus {
  const llm = present(env.LLM_API_KEY)
  const jupiter = present(env.JUPITER_API_KEY)
  return {
    llm,
    jupiter,
    readyForDryRun: llm,
    readyForLive: llm && jupiter,
  }
}

export function formatInitMessage(opts: { directory: string; firstRun: boolean; status: SetupStatus }): string {
  const { directory, firstRun, status } = opts
  const heading = firstRun ? 'Etemaro first-time setup  (~1 minute)' : 'Etemaro setup check'
  const mark = (ok: boolean) => (ok ? 'x' : ' ')
  const lines = [
    heading,
    '',
    firstRun ? 'Dry-run is on by default. No live trades yet.' : 'Checking LLM credentials.',
    `Runtime: ${directory}`,
    '',
    `  [${mark(status.llm)}] LLM      LLM_API_KEY`,
    `  [${mark(status.jupiter)}] Jupiter  JUPITER_API_KEY  (live swaps only)`,
    '',
  ]
  if (status.readyForDryRun) {
    lines.push(firstRun ? 'Setup complete.' : 'Setup complete')
    lines.push('')
    lines.push('Next:')
    lines.push('  etemaro start --dry-run')
  } else {
    lines.push(`Add the missing keys in ${path.join(directory, '.env')}`)
    lines.push('then run:')
    lines.push('  etemaro start --dry-run')
  }
  return lines.join('\n')
}

export function writeRuntimeSkeleton(
  directory: string,
  opts: { defaultUserConfigStr: string; defaultStrategies: unknown },
): SkeletonResult {
  const configDir = path.join(directory, 'config')
  const dataDir = path.join(directory, 'data')
  fs.mkdirSync(directory, { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })

  const envFile = path.join(directory, '.env')
  let envCreated = false
  if (!fs.existsSync(envFile)) {
    fs.writeFileSync(envFile, ENV_TEMPLATE)
    envCreated = true
  }

  const userConfigFile = path.join(configDir, 'user-config.json')
  let configCreated = false
  if (!fs.existsSync(userConfigFile)) {
    fs.writeFileSync(
      userConfigFile,
      opts.defaultUserConfigStr.endsWith('\n') ? opts.defaultUserConfigStr : `${opts.defaultUserConfigStr}\n`,
    )
    configCreated = true
  }

  const sharedStrategyFile = path.join(dataDir, 'strategy-library.shared.json')
  let strategyCreated = false
  if (!fs.existsSync(sharedStrategyFile)) {
    fs.writeFileSync(sharedStrategyFile, `${JSON.stringify({ strategies: opts.defaultStrategies }, null, 2)}\n`)
    strategyCreated = true
  }

  return {
    directory,
    env: { path: envFile, created: envCreated },
    config: { path: userConfigFile, created: configCreated },
    strategyLibrary: { path: sharedStrategyFile, created: strategyCreated },
  }
}

function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function unescapeEnvValue(value: string): string {
  return value.replace(/\\([\\"])/g, '$1')
}

export function upsertEnvVars(fileContents: string, updates: Record<string, string>): string {
  let next = fileContents
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}="${escapeEnvValue(value)}"`
    const re = new RegExp(`^${key}=.*$`, 'm')
    if (re.test(next)) next = next.replace(re, line)
    else next += `${(next.endsWith('\n') ? '' : '\n') + line}\n`
  }
  return next
}

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = unescapeEnvValue(value.slice(1, -1))
    }
    out[key] = value
  }
  return out
}

export async function maybePromptSecrets(opts: {
  interactive: boolean
  status: SetupStatus
  ask: (question: string) => Promise<string>
}): Promise<Record<string, string>> {
  if (!opts.interactive) return {}
  const updates: Record<string, string> = {}
  if (!opts.status.llm) {
    const llm = (await opts.ask('LLM API key (OpenRouter / OpenAI). Paste, or Enter to skip: ')).trim()
    if (llm) updates.LLM_API_KEY = llm
  }
  return updates
}

type DotenvLoad = (opts?: { path?: string; override?: boolean }) => unknown

export function loadRuntimeDotenv(homeDir: string, dotenvLoad: DotenvLoad = dotenv.config): void {
  const envPath = path.join(homeDir, '.env')
  if (fs.existsSync(envPath)) {
    dotenvLoad({ path: envPath })
  }
  dotenvLoad({ override: true })
}
