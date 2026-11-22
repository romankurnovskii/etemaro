/**
 * Parse a JSON-object field from the config editor.
 *
 * The editor keeps the raw text in local state so a half-typed value does not
 * snap back; this decides whether the current text is safe to propagate.
 */
export type JsonFieldResult = { ok: true; value: unknown } | { ok: false }

export function parseJsonField(text: string): JsonFieldResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}
