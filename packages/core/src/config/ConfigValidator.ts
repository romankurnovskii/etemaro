/**
 * @file ConfigValidator.ts
 * @description Zod schema based validator for runtime application configuration files (Version 3).
 *
 * @features
 * - Uses nested Zod schema mapping directly to config shape
 * - Validates types, env refs, and thresholds using Zod
 * - Does not perform backward-compatible auto-migration from flattened configs
 *
 */

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { getEtemaroDir, REPO_ROOT, USER_CONFIG_PATH } from '../shared/constants.js'
import { defaultUserConfigStr } from './defaultUserConfig.js'
import { UserConfigSchema, type ValidatedUserConfig } from './schema.js'

let dotenvLoaded = false
export function ensureDotenvLoaded(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return

  // 1. Load user-level env (~/.config/etemaro/.env)
  const homeEnv = path.join(getEtemaroDir(), '.env')
  if (fs.existsSync(homeEnv)) {
    dotenv.config({ path: homeEnv })
  }

  // 2. Load workspace/repo .env if present
  const repoEnv = path.join(REPO_ROOT, '.env')
  if (fs.existsSync(repoEnv)) {
    dotenv.config({ path: repoEnv, override: true })
  } else {
    dotenv.config({ override: true })
  }
}

function getActiveConfigPath(): string {
  const envPath = process.env.USER_CONFIG_PATH?.trim()
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(REPO_ROOT, envPath)
  }
  return USER_CONFIG_PATH
}

function getConfigFileName(): string {
  return path.basename(getActiveConfigPath())
}

export function isHelpOrInfoCommand(): boolean {
  return (
    process.env.ETEMARO_SKIP_ENV_VALIDATION === '1' ||
    process.argv.some((a) =>
      ['help', '--help', '-h', '--version', '-v', 'init', 'generate-wallet', 'new-wallet', 'wallet'].includes(a),
    )
  )
}

export function loadAndValidateConfig(): ValidatedUserConfig {
  ensureDotenvLoaded()
  const isExplicitConfig = Boolean(process.env.USER_CONFIG_PATH?.trim())
  const activeConfigPath = getActiveConfigPath()

  // Ensure user config directory and file exist
  if (!fs.existsSync(activeConfigPath)) {
    if (isExplicitConfig) {
      if (isHelpOrInfoCommand()) {
        return JSON.parse(defaultUserConfigStr)
      }
      throw new Error(`Configuration file not found at "${activeConfigPath}"`)
    }
    console.log(`[config] ${getConfigFileName()} not found, initializing from default config`)
    fs.mkdirSync(path.dirname(activeConfigPath), { recursive: true })
    fs.writeFileSync(activeConfigPath, `${defaultUserConfigStr}\n`, 'utf8')
  }

  // Read user config
  let raw: Record<string, unknown>
  try {
    const content = fs.readFileSync(activeConfigPath, 'utf8')
    if (!content.trim()) {
      if (isExplicitConfig) {
        throw new Error(`Configuration file is empty: "${activeConfigPath}"`)
      }
      fs.writeFileSync(activeConfigPath, `${defaultUserConfigStr}\n`, 'utf8')
      raw = JSON.parse(defaultUserConfigStr)
    } else {
      raw = JSON.parse(content)
    }
  } catch (e) {
    throw new Error(`Failed to parse ${getConfigFileName()}: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    })
  }

  // Migrate legacy hardcoded RPC defaults to .env values when an override is present
  const legacyPrimaryRpc = 'https://pump.helius-rpc.com'
  const rawConnection = raw.connection as { rpcUrl?: string } | undefined
  if (
    typeof raw?.connection === 'object' &&
    rawConnection?.rpcUrl === legacyPrimaryRpc &&
    process.env.RPC_URL &&
    process.env.RPC_URL !== legacyPrimaryRpc
  ) {
    rawConnection.rpcUrl = process.env.RPC_URL
  }

  // If running info commands, we can bypass strict parsing
  if (isHelpOrInfoCommand()) {
    return raw as unknown as ValidatedUserConfig // Bypass validation
  }

  // Validate with Zod
  const result = UserConfigSchema.safeParse(raw)

  if (!result.success) {
    const issues = result.error?.issues ?? (result.error as any)?.errors ?? []
    const errorMessages = issues.map((err: any) => `  - ${err.path.join('.')}: ${err.message}`).join('\n')
    const err: any = new Error(
      `${getConfigFileName()} has invalid or missing fields:\n${errorMessages}\n\n` +
        'Please ensure you are using the Version 3 schema structure.',
      { cause: result.error },
    )
    err.issues = issues
    err.configPath = USER_CONFIG_PATH
    throw err
  }

  return result.data
}
