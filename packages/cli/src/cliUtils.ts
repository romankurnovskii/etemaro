/**
 * @file cliUtils.ts
 * @description Interactive prompting, path expansion, and process-exit helpers for the CLI.
 */
import path from 'node:path'
import { stdin as stdinStream, stdout as stdoutStream } from 'node:process'
import nodeReadline from 'node:readline'
import readline from 'node:readline/promises'
import { Writable } from 'node:stream'

export async function promptSecret(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false
    let resolved = false
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          stdoutStream.write(chunk, encoding)
        }
        callback()
      },
    })

    const isTTY = Boolean((stdinStream as any).isTTY)
    const rl = nodeReadline.createInterface({
      input: stdinStream,
      output: mutableStdout,
      terminal: isTTY,
    })

    stdoutStream.write(promptText)
    muted = true

    rl.question('', (answer) => {
      if (resolved) return
      resolved = true
      muted = false
      if (isTTY) {
        stdoutStream.write('\n')
      }
      rl.close()
      resolve(answer.trim())
    })

    rl.on('close', () => {
      if (resolved) return
      resolved = true
      muted = false
      if (isTTY) {
        stdoutStream.write('\n')
      }
      resolve('')
    })
  })
}

export function expandHome(input: string): string {
  const value = String(input ?? '').trim()
  if (value === '~') return process.env.HOME || value
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2))
  return value
}

export interface WalletImportSource {
  alias?: string
  filePath?: string
  usePrompt: boolean
}

/**
 * Fill in missing wallet-import inputs through a guided flow.
 * All prompting goes through `ask`, keeping this pure and unit-testable.
 */
export async function resolveWalletImportSource(
  initial: WalletImportSource,
  ask: (question: string) => Promise<string>,
): Promise<WalletImportSource> {
  const result: WalletImportSource = { ...initial }

  if (!result.alias) {
    const answer = (await ask('Wallet alias (name): ')).trim()
    if (answer) result.alias = answer
  }

  if (!result.filePath && !result.usePrompt) {
    const choice = (
      await ask('Import from:\n  1) Solana CLI keypair JSON file\n  2) Base58 private key\nChoice (1/2) [2]: ')
    )
      .trim()
      .toLowerCase()
    if (choice === '1' || choice.startsWith('f')) {
      const filePath = (await ask('Path to keypair JSON: ')).trim()
      if (filePath) result.filePath = filePath
    } else {
      result.usePrompt = true
    }
  }

  return result
}

export function out(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  process.exit(0)
}

export function die(msg: string, extra: Record<string, unknown> = {}): never {
  process.stderr.write(`${JSON.stringify({ error: msg, ...extra })}\n`)
  process.exit(1)
}

export function defaultEtemaroHome(): string {
  const fromEnv = process.env.ETEMARO_HOME?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const xdg = process.env.XDG_CONFIG_HOME || (home ? path.join(home, '.config') : '')
  return path.join(xdg, 'etemaro')
}

export async function askTty(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdinStream, output: stdoutStream })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
