#!/usr/bin/env node
/**
 * Enforces the Dependency Rule across @etemaro/core source layers.
 * Inner layers must not import outer layers:
 *   domain      -> may not import adapters, application
 *   application -> may not import adapters
 *   shared      -> may not import adapters, application, domain
 *   ports       -> may not import adapters, application, domain
 *   adapters    -> may not import application
 * Test files are excluded.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CORE_SRC = path.join(ROOT, 'packages', 'core', 'src')
const LAYER_RE = /packages\/core\/src\/(domain|application|adapters|ports|shared|config)\//
const RULES = {
  domain: ['adapters', 'application'],
  application: ['adapters'],
  shared: ['adapters', 'application', 'domain'],
  ports: ['adapters', 'application', 'domain'],
  adapters: ['application'],
  config: ['adapters', 'application', 'domain'],
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

function layerOf(absPath) {
  const m = absPath.split(path.sep).join('/').match(LAYER_RE)
  return m ? m[1] : null
}

const violations = []
for (const file of walk(CORE_SRC)) {
  const fromLayer = layerOf(file)
  if (!fromLayer) continue
  const forbidden = RULES[fromLayer] || []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/from ['"](\.[^'"]+)['"]/)
    if (!m) return
    let target = path.resolve(path.dirname(file), m[1])
    if (!fs.existsSync(target) && fs.existsSync(target + '.ts')) target += '.ts'
    const toLayer = layerOf(target)
    if (toLayer && forbidden.includes(toLayer)) {
      violations.push(path.relative(ROOT, file) + ':' + (i + 1) + '  ' + fromLayer + ' -> ' + toLayer + '  ' + line.trim())
    }
  })
}

if (violations.length > 0) {
  console.error('[boundaries] ' + violations.length + ' forbidden import(s):')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('[boundaries] OK — dependency rule holds')
