import { type ReactNode, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api'
import type { ManagedAgent } from '../lib/ipc'

function ConfigField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  const type = typeof value
  const inputId = `config-field-${name}`
  let input: ReactNode
  if (type === 'boolean') {
    input = <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  } else if (type === 'number') {
    input = <input id={inputId} type="number" value={value as number} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  } else if (type === 'object' && value !== null) {
    input = (
      <textarea
        id={inputId}
        value={JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)) } catch {}
        }}
        style={{ width: '100%', minHeight: '80px', fontFamily: 'monospace', fontSize: '12px' }}
      />
    )
  } else {
    input = <input id={inputId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <label className="field" htmlFor={inputId}>
      <span>{name}</span>
      {input}
    </label>
  )
}

interface ConfigViewProps {
  agents: ManagedAgent[]
  token: string
}

interface ConfigFile {
  path: string
  content: Record<string, unknown>
}

export function ConfigView({ agents, token }: ConfigViewProps) {
  const [selectedAgent, setSelectedAgent] = useState<ManagedAgent | null>(null)
  const [config, setConfig] = useState<ConfigFile | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedAgent) loadConfig(selectedAgent.configPath)
  }, [selectedAgent, token])

  const loadConfig = async (path: string) => {
    try {
      const data = await fetchJson<{ config: Record<string, unknown> }>(`/api/config?path=${encodeURIComponent(path)}`, token)
      setConfig({ path, content: data?.config ?? {} })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config')
      setConfig(null)
    }
  }

  const handleChange = (key: string, value: unknown) => {
    if (!config) return
    setConfig({ ...config, content: { ...config.content, [key]: value } })
  }

  const handleSave = async () => {
    if (!config) return
    setSaveStatus('saving')
    try {
      await fetchJson(`/api/config?path=${encodeURIComponent(config.path)}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: config.content }),
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      setSaveStatus('error')
      setError(e instanceof Error ? e.message : 'Failed to save config')
    }
  }

  if (!selectedAgent) {
    return (
      <div className="card">
        <h2>Configuration</h2>
        <p className="muted">Select an agent from the list to view and edit its configuration.</p>
        <div className="mt">
          {agents.map((agent) => (
            <button key={agent.id} type="button" className="tool-item" onClick={() => setSelectedAgent(agent)}>
              <div className="name">
                {agent.name} <span className="small muted">({agent.id})</span>
              </div>
              <div className="desc">{agent.configPath}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>{selectedAgent.name}</h2>
          <p className="muted small">{selectedAgent.configPath}</p>
        </div>
        <button type="button" className="ghost" onClick={() => setSelectedAgent(null)}>
          Back to list
        </button>
      </div>

      {error && <div className="error mt">{error}</div>}

      {config && (
        <div className="mt">
          {Object.entries(config.content).map(([k, v]) => (
            <ConfigField key={k} name={k} value={v} onChange={(val) => handleChange(k, val)} />
          ))}
          <div className="row mt">
            <button type="button" className="primary" onClick={handleSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : 'Save Changes'}
            </button>
            <button type="button" className="ghost" onClick={() => loadConfig(selectedAgent.configPath)}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}