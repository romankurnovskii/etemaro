/**
 * @file ToolRegistry.ts
 * @description Single registration point for agent tools. Joins LLM-facing JSON
 * schemas (ToolDefinition) with executable handlers and derives the write/protected
 * permission classification, so schema, handler, and permissions cannot drift apart.
 *
 * @features
 * - 1:1 validation: every exposed definition must have a handler (fail-fast at load)
 * - Internal tools: handlers with no definition are executable by CLI/IPC but never
 *   advertised to the LLM (e.g. close_all_positions)
 * - Derives writeTools / protectedTools from one declaration
 *
 * @dependencies shared/types
 */
import type { ToolDefinition } from '../shared/types.js'

export type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>

export type ToolKind = 'read' | 'write' | 'protected'

export interface ToolRegistryOptions {
  /** LLM-facing JSON schemas. Each must have a matching handler. */
  definitions: readonly ToolDefinition[]
  /** name -> handler. May include internal handlers that have no definition. */
  handlers: Readonly<Record<string, ToolHandler>>
  /** Tools that acquire the global write lock. Must reference existing handlers. */
  writeTools?: Iterable<string>
  /** Tools requiring explicit confirmation (superset of writeTools). */
  protectedTools?: Iterable<string>
}

export interface RegisteredTool {
  name: string
  definition: ToolDefinition | null
  handler: ToolHandler
  kind: ToolKind
}

export class ToolRegistry {
  /** Tools that acquire the global write lock. */
  readonly writeTools: Set<string>
  /** Tools that require explicit confirmation. */
  readonly protectedTools: Set<string>

  private readonly byName = new Map<string, RegisteredTool>()
  private readonly definitions: readonly ToolDefinition[]
  private readonly internal: string[]

  constructor(options: ToolRegistryOptions) {
    const { definitions, handlers, writeTools = [], protectedTools = [] } = options
    const write = new Set(writeTools)
    const protectedSet = new Set(protectedTools)

    const definitionsByName = new Map<string, ToolDefinition>()
    for (const definition of definitions) {
      const name = definition.function.name
      if (definitionsByName.has(name)) {
        throw new Error(`ToolRegistry: duplicate definition for tool "${name}"`)
      }
      definitionsByName.set(name, definition)
      if (!handlers[name]) {
        throw new Error(`ToolRegistry: tool "${name}" has a definition but no handler`)
      }
    }

    for (const name of [...write, ...protectedSet]) {
      if (!handlers[name]) {
        throw new Error(`ToolRegistry: tool "${name}" is marked write/protected but has no handler`)
      }
    }

    for (const [name, handler] of Object.entries(handlers)) {
      this.byName.set(name, {
        name,
        definition: definitionsByName.get(name) ?? null,
        handler,
        kind: protectedSet.has(name) ? 'protected' : write.has(name) ? 'write' : 'read',
      })
    }

    this.writeTools = write
    this.protectedTools = protectedSet
    this.definitions = definitions
    this.internal = Object.keys(handlers).filter((name) => !definitionsByName.has(name))
  }

  /** LLM-facing definitions, in registration order. */
  getDefinitions(): readonly ToolDefinition[] {
    return this.definitions
  }

  /** Every executable handler name, including internal-only tools. */
  names(): string[] {
    return [...this.byName.keys()]
  }

  /** Names advertised to the LLM. */
  exposedNames(): string[] {
    return this.definitions.map((d) => d.function.name)
  }

  /** Handlers that are executable but not advertised to the LLM. */
  internalNames(): string[] {
    return this.internal
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  get(name: string): RegisteredTool | undefined {
    return this.byName.get(name)
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.byName.get(name)?.handler
  }

  getDefinition(name: string): ToolDefinition | null {
    return this.byName.get(name)?.definition ?? null
  }

  kindOf(name: string): ToolKind | undefined {
    return this.byName.get(name)?.kind
  }

  isWrite(name: string): boolean {
    return this.writeTools.has(name)
  }

  isProtected(name: string): boolean {
    return this.protectedTools.has(name)
  }
}
