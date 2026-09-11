/**
 * @file stateStore.ts
 * @description Swappable StateStorePort binding with a JSON-file default implementation.
 * Domain modules call loadState/saveState instead of touching the filesystem utilities.
 */
import type { StateStorePort, StateStoreReadOptions } from '../ports/state-store.js'
import { loadJsonFile, saveJsonFile } from './utils.js'

class JsonStateStore implements StateStorePort {
  read<T>(filePath: string, fallback: T, options?: StateStoreReadOptions): T {
    return loadJsonFile<T>(filePath, fallback, options)
  }

  write(filePath: string, data: unknown): void {
    saveJsonFile(filePath, data)
  }
}

let activeStateStore: StateStorePort = new JsonStateStore()

export function getStateStore(): StateStorePort {
  return activeStateStore
}

export function setStateStore(store: StateStorePort): void {
  activeStateStore = store
}

export function resetStateStore(): void {
  activeStateStore = new JsonStateStore()
}

/** Read a JSON state file through the active store. */
export function readStateFile<T>(filePath: string, fallback: T, options?: StateStoreReadOptions): T {
  return activeStateStore.read(filePath, fallback, options)
}

/** Write a JSON state file through the active store. */
export function writeStateFile(filePath: string, data: unknown): void {
  activeStateStore.write(filePath, data)
}
