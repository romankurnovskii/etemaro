import { dataPath, MAX_DECISIONS } from '../shared/constants.js'
import type { Decision, DecisionType } from '../shared/types.js'
import { loadJsonFile, saveJsonFile } from '../shared/utils.js'

const DECISION_LOG_FILE = dataPath('decision-log.json')

interface DecisionLogData {
  decisions: Decision[]
}

function load(): DecisionLogData {
  return loadJsonFile<DecisionLogData>(DECISION_LOG_FILE, { decisions: [] })
}

function save(data: DecisionLogData): void {
  saveJsonFile(DECISION_LOG_FILE, data)
}

function sanitize(value: unknown, maxLen = 280): string | null {
  if (value == null) return null
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen) || null
}

/**
 * Extracts candidate rejections from LLM reports formatted with a `REJECTED` section.
 */
export function parseRejectedCandidates(content: string): string[] {
  if (!content) return []
  const rejectedMatch = content.match(
    /(?:^|\n)\s*(?:###?\s*)?REJECTED\s*:?\s*\n([\s\S]*?)(?:\n\s*(?:###?|[A-Z][A-Z\s]{3,}:|$))/i,
  )
  if (!rejectedMatch?.[1]) return []
  const lines = rejectedMatch[1].split('\n')
  const rejected: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Strip leading bullet point: -, *, •, or numbering 1.
    const clean = trimmed.replace(/^[-*•\d.]+\s*/, '').trim()
    if (clean && !clean.startsWith('(') && clean.toLowerCase() !== '<none>' && clean.toLowerCase() !== 'none') {
      rejected.push(clean)
    }
  }
  return rejected
}

interface AppendDecisionEntry {
  type?: DecisionType
  actor?: string
  pool?: string | null
  pool_name?: string | null
  position?: string | null
  summary?: string | null
  reason?: string | null
  risks?: string[]
  metrics?: Record<string, unknown>
  rejected?: string[]
}

export function appendDecision(entry: AppendDecisionEntry): Decision {
  const data = load()
  const decision: Decision = {
    id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type: entry.type || 'note',
    actor: entry.actor || 'GENERAL',
    pool: entry.pool || null,
    pool_name: sanitize(entry.pool_name || entry.pool, 120),
    position: entry.position || null,
    summary: sanitize(entry.summary),
    reason: sanitize(entry.reason, 2048),
    risks: Array.isArray(entry.risks) ? (entry.risks.map((r) => sanitize(r, 140)).filter(Boolean) as string[]) : [],
    metrics: entry.metrics || {},
    rejected: Array.isArray(entry.rejected)
      ? (entry.rejected.map((r) => sanitize(r, 300)).filter(Boolean) as string[])
      : [],
  }
  data.decisions.unshift(decision)
  data.decisions = data.decisions.slice(0, MAX_DECISIONS)
  save(data)
  return decision
}

export function getRecentDecisions(limit = 10): Decision[] {
  const data = load()
  return (data.decisions || []).slice(0, limit)
}

export function getDecisionSummary(limit = 6): string {
  const decisions = getRecentDecisions(limit)
  if (!decisions.length) return 'No recent structured decisions yet.'
  return decisions
    .map((d, i) => {
      const bits = [
        `${i + 1}. [${d.actor}] ${d.type.toUpperCase()} ${d.pool_name || d.pool || 'unknown pool'}`,
        d.summary ? `summary: ${d.summary}` : null,
        d.reason ? `reason: ${d.reason}` : null,
        d.risks?.length ? `risks: ${d.risks.join(', ')}` : null,
        d.rejected?.length ? `rejected: ${d.rejected.join(' | ')}` : null,
      ].filter(Boolean)
      return bits.join(' | ')
    })
    .join('\n')
}
