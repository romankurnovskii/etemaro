/**
 * @file state-store.ts
 * @description Persistence port. Domain state modules read/write through this interface
 * so the backing store (JSON files today) can be swapped without touching domain logic.
 */

export interface StateStoreReadOptions {
  label?: string
  warnOnCorrupt?: boolean
  critical?: boolean
}

export interface StateStorePort {
  /** Read and parse a JSON file; return fallback when missing or (optionally) corrupt. */
  read<T>(filePath: string, fallback: T, options?: StateStoreReadOptions): T
  /** Atomically write a JSON file. */
  write(filePath: string, data: unknown): void
}
