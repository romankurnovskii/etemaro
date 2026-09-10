/**
 * @file validation.ts
 * @description Shared report shape for file/document validators surfaced by the CLI.
 *
 * Both `etemaro config validate` and `etemaro strategy validate` return this shape so
 * the CLI renders one comprehensive format regardless of what is being validated.
 */

export type ValidationStatus = 'VALID' | 'INVALID'

export interface ValidationEntry {
  /** Entry identifier (e.g. "config" or a strategy id). */
  id: string
  status: ValidationStatus
  errors: string[]
  warnings: string[]
  infos: string[]
  /** Keys that are not part of the schema and will be ignored by the runtime. */
  unknownFields: string[]
  /** Optional per-field consumption note (strategy validation). */
  usage?: Record<string, string>
}

export interface ValidationReport {
  file: string
  ok: boolean
  entries: ValidationEntry[]
  totals: { checked: number; valid: number; invalid: number }
  parseError?: string
}
