import path from 'node:path'
import { USER_CONFIG_PATH } from '../shared/constants.js'

export interface ConfigIssue {
  path?: Array<string | number>
  message?: string
  params?: {
    envVar?: string
    ref?: string
    [key: string]: unknown
  }
}

/**
 * Format a human-readable error message when configuration loading or validation fails.
 * Points to the exact JSON configuration file path, identifies required fields pointing to
 * unset environment variables, and instructs the user how to either set the env var or
 * update the JSON file directly.
 */
export function formatConfigLoadError(err: any, fallbackPath?: string): string {
  const configFilePath =
    err?.configPath ||
    err?.cause?.configPath ||
    fallbackPath ||
    process.env.USER_CONFIG_PATH ||
    USER_CONFIG_PATH ||
    path.resolve(process.cwd(), 'config', 'user-config.json')

  const issues: ConfigIssue[] =
    (Array.isArray(err?.issues) && err.issues) ||
    (Array.isArray(err?.cause?.issues) && err.cause.issues) ||
    (Array.isArray(err?.cause?.cause?.issues) && err.cause.cause.issues) ||
    (Array.isArray(err?.cause?.cause?.errors) && err.cause.cause.errors) ||
    []

  if (issues.length === 0) {
    return [
      '',
      '[config] Failed to load configuration:',
      `  Configuration file: ${configFilePath}`,
      `  Error: ${err?.message ?? String(err)}`,
      '',
    ].join('\n')
  }

  const envIssues: Array<{ field: string; envVar: string; ref: string }> = []
  const otherIssues: Array<{ field: string; message: string }> = []

  for (const issue of issues) {
    const field = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'configuration'
    const envMatch = issue.message?.match(/Environment variable (\w+)/)
    const envVar = issue.params?.envVar || envMatch?.[1]
    const ref = issue.params?.ref || (envVar ? `env.${envVar}` : '')
    if (envVar) {
      envIssues.push({ field, envVar, ref })
    } else {
      otherIssues.push({ field, message: issue.message || 'Invalid value' })
    }
  }

  const lines: string[] = []
  lines.push('')
  lines.push('[config] Configuration validation failed:')
  lines.push(`  Configuration file: ${configFilePath}`)
  lines.push('')

  if (envIssues.length > 0) {
    lines.push('The following required configuration values reference environment variables that are not set:')
    for (const item of envIssues) {
      lines.push(
        `  • Field "${item.field}" requires environment variable: ${item.envVar} (referenced as "${item.ref}")`,
      )
    }
    lines.push('')
    lines.push('You should EITHER:')
    lines.push('  1. Set the environment variable in your .env file or system environment:')
    const uniqueVars = [...new Set(envIssues.map((i) => i.envVar))]
    for (const v of uniqueVars) {
      lines.push(`     ${v}=<value>`)
    }
    lines.push('')
    lines.push('  2. OR update the value directly in your configuration file:')
    lines.push(`     ${configFilePath}`)
    lines.push('     (specify the actual value directly instead of referencing "env.VARIABLE")')
  }

  if (otherIssues.length > 0) {
    if (envIssues.length > 0) lines.push('')
    lines.push('Additional configuration schema errors:')
    for (const item of otherIssues) {
      lines.push(`  • Field "${item.field}": ${item.message}`)
    }
    lines.push(`\nPlease review and fix your configuration file: ${configFilePath}`)
  }

  lines.push('')
  return lines.join('\n')
}
