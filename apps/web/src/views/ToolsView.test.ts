import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../lib/api'
import type { ToolDescriptor } from '../lib/ipc'
import { normalizeArgs, ToolsView } from './ToolsView'

vi.mock('../lib/api', () => ({ fetchJson: vi.fn() }))
const readTool: ToolDescriptor = {
  name: 'fixture_read',
  description: 'Synthetic test-only operation',
  isWrite: false,
  isProtected: false,
  parameters: {
    properties: {
      count: { type: 'integer' },
      options: { type: 'object' },
      mode: { type: 'number', enum: [1, 2] },
      enabled: { type: 'boolean' },
    },
    required: ['count'],
  },
}
const protectedTool: ToolDescriptor = {
  name: 'fixture_protected',
  description: 'Synthetic test-only protected operation',
  isWrite: true,
  isProtected: true,
  parameters: { properties: { note: { type: 'string' } } },
}
let renderer: ReactTestRenderer | undefined
const submit = () => renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} })
const button = (text: string) => renderer!.root.findAllByType('button').find((b) => b.children.join('') === text)!
const render = async (token = 'fixture-token') => {
  await act(async () => {
    renderer = create(
      createElement(ToolsView, { catalog: [readTool, protectedTool], token, initialToolName: readTool.name }),
    )
  })
}
const count = async (value = '2') => {
  await act(async () => renderer!.root.findByProps({ id: 'tool-field-count' }).props.onChange({ target: { value } }))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer?.unmount()
    })
  renderer = undefined
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('tool parameter validation', () => {
  it('normalizes typed enum values, numeric arrays and explicit false booleans without mutating input', () => {
    const descriptor = {
      ...readTool,
      parameters: {
        properties: { ...readTool.parameters.properties, ids: { type: 'array', items: { type: 'integer' } } },
        required: ['count', 'enabled'],
      },
    }
    const raw = { count: '2', mode: '1', enabled: false, ids: '3, 4', options: '{"safe":true}' }
    expect(normalizeArgs(descriptor, raw)).toEqual({
      count: 2,
      mode: 1,
      enabled: false,
      ids: [3, 4],
      options: { safe: true },
    })
    expect(raw.options).toBe('{"safe":true}')
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid integer %s rather than posting NaN/null or rounding',
    (value) => {
      expect(() => normalizeArgs(readTool, { count: value })).toThrow('finite safe integer')
    },
  )
  it('rejects missing required fields, invalid JSON, array-shaped objects and enum values outside the catalog', () => {
    expect(() => normalizeArgs(readTool, {})).toThrow('count is required')
    expect(() => normalizeArgs(readTool, { count: 1, options: '{broken' })).toThrow('valid JSON')
    expect(() => normalizeArgs(readTool, { count: 1, options: '[]' })).toThrow('JSON object')
    expect(() => normalizeArgs(readTool, { count: 1, mode: '3' })).toThrow('available options')
  })
})

describe('tool execution and copy workflow', () => {
  it('copies only displayed output on request without running the tool again', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ result: { fixture: true } })
    await render()
    await count()
    await act(async () => {
      submit()
    })
    const output = renderer!.root.findByProps({ 'aria-label': 'Tool output' }).props.value
    await act(async () => button('Copy output').props.onClick())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(output)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('Copied output.')
  })
  it('reports clipboard denial and retains selectable output', async () => {
    vi.mocked(fetchJson).mockResolvedValue(null)
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Denied'))
    await render()
    await count()
    await act(async () => {
      submit()
    })
    await act(async () => button('Copy output').props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': 'Tool output' }).props.value).toBe('null')
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toContain('copy it manually')
  })
  it('clears arguments, result and protected confirmation when selecting another tool', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ result: 'fixture output' })
    await render()
    await count()
    await act(async () => {
      submit()
    })
    await act(async () =>
      renderer!.root.findByProps({ 'aria-label': `Select tool ${protectedTool.name}` }).props.onClick(),
    )
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Tool output' })).toHaveLength(0)
    expect(button('Run tool').props.disabled).toBe(true)
    await act(async () =>
      renderer!.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }),
    )
    await act(async () => renderer!.root.findByProps({ 'aria-label': `Select tool ${readTool.name}` }).props.onClick())
    expect(renderer!.root.findByProps({ id: 'tool-field-count' }).props.value).toBe('')
    await act(async () =>
      renderer!.root.findByProps({ 'aria-label': `Select tool ${protectedTool.name}` }).props.onClick(),
    )
    expect(renderer!.root.findByProps({ type: 'checkbox' }).props.checked).toBe(false)
    expect(fetchJson).toHaveBeenCalledTimes(1)
  })
  it('blocks protected submissions even when a caller bypasses the disabled submit button', async () => {
    await render()
    await act(async () =>
      renderer!.root.findByProps({ 'aria-label': `Select tool ${protectedTool.name}` }).props.onClick(),
    )
    await act(async () => {
      submit()
    })
    expect(fetchJson).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('Confirm')
  })
  it('does not issue duplicate requests and discards an old response after the token changes', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(fetchJson).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }) as never,
    )
    await render()
    await count()
    await act(async () => {
      submit()
      submit()
    })
    expect(fetchJson).toHaveBeenCalledTimes(1)
    const request = vi.mocked(fetchJson).mock.calls[0]![2]!
    expect(button('Running…').props.disabled).toBe(true)
    await act(async () =>
      renderer!.update(
        createElement(ToolsView, {
          catalog: [readTool, protectedTool],
          token: 'fixture-token-2',
          initialToolName: readTool.name,
        }),
      ),
    )
    expect(request.signal?.aborted).toBe(true)
    await act(async () => resolve({ result: 'old identity output' }))
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Tool output' })).toHaveLength(0)
    expect(button('Run tool').props.disabled).toBe(false)
    expect(renderer!.root.findByProps({ id: 'tool-field-count' }).props.value).toBe('')
  })
  it('keeps validation errors separate from tool output and sends no invalid request', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ result: 'previous valid output' })
    await render()
    await count()
    await act(async () => {
      submit()
    })
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Tool output' })).toHaveLength(1)
    await count('')
    await act(async () => {
      submit()
    })
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('count is required')
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Tool output' })).toHaveLength(0)
  })
})
