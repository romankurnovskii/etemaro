/**
 * @file config-validation.ts
 * @description Validates a agent-config document/file against `AgentConfigSchema` and returns
 * the shared ValidationReport shape (same comprehensive format as strategy validation).
 *
 * The same Zod schema used at boot is the single source of truth. Unknown keys and
 * unset `env.*` references are reported; `envOptional` downgrades the latter to warnings so
 * pre-commit can validate structure without requiring secrets.
 */
import fs from 'node:fs'
import type { ValidationEntry, ValidationReport } from '../shared/validation.js'
import { AgentConfigSchema } from './schema.js'

export interface ConfigValidationOptions {
  /** Downgrade unset environment-variable references from error to warning. */
  envOptional?: boolean
}

interface ZodLikeIssue {
  code?: string
  path?: Array<string | number>
  message?: string
  keys?: string[]
  params?: { envVar?: string; [key: string]: unknown }
}

function isEnvIssue(issue: ZodLikeIssue): boolean {
  if (issue.params && typeof issue.params.envVar === 'string') return true
  // Zod does not always preserve `params`; fall back to the message shape.
  return typeof issue.message === 'string' && /Environment variable \w+ is not set/.test(issue.message)
}

function invalidReport(file: string, message: string): ValidationReport {
  return {
    file,
    ok: false,
    parseError: message,
    entries: [
      {
        id: 'config',
        status: 'INVALID',
        errors: [message],
        warnings: [],
        infos: [],
        unknownFields: [],
      },
    ],
    totals: { checked: 1, valid: 0, invalid: 1 },
  }
}

/** Validate a parsed config object. */
export function validateConfigDocument(
  doc: unknown,
  opts: ConfigValidationOptions = {},
): { ok: boolean; entries: ValidationEntry[]; totals: ValidationReport['totals'] } {
  const result = AgentConfigSchema.safeParse(doc)
  const errors: string[] = []
  const warnings: string[] = []
  const unknownFields: string[] = []

  if (!result.success) {
    const issues = (result.error.issues ?? []) as ZodLikeIssue[]
    for (const issue of issues) {
      const path = (issue.path ?? []).join('.')
      if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
        for (const key of issue.keys) {
          const full = path ? `${path}.${key}` : key
          unknownFields.push(full)
          errors.push(
            `unknown field "${full}" is not part of the config schema — will be ignored (strict schema rejects it at boot)`,
          )
        }
        continue
      }
      const text = `${path ? `${path}: ` : ''}${issue.message ?? 'invalid value'}`
      if (isEnvIssue(issue) && opts.envOptional) warnings.push(text)
      else errors.push(text)
    }
  }

  const status = errors.length === 0 ? 'VALID' : 'INVALID'
  const entry: ValidationEntry = { id: 'config', status, errors, warnings, infos: [], unknownFields }
  return {
    ok: status === 'VALID',
    entries: [entry],
    totals: { checked: 1, valid: status === 'VALID' ? 1 : 0, invalid: status === 'VALID' ? 0 : 1 },
  }
}

/** Read and validate a config JSON file. */
export function validateConfigFile(filePath: string, opts: ConfigValidationOptions = {}): ValidationReport {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    return invalidReport(filePath, `cannot read config file: ${e instanceof Error ? e.message : String(e)}`)
  }
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (e) {
    return invalidReport(filePath, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { file: filePath, ...validateConfigDocument(doc, opts) }
}
