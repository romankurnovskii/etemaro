// Etemaro web UI — buildless SPA over the daemon IPC/HTTP API.
// No bundler: served directly by IpcServer from apps/web.

const LS_AGENTS = 'etemaro.agents'
const LS_ACTIVE = 'etemaro.activeAgent'
const LS_TOKEN = 'etemaro.token'
const MAX_LOGS = 500
const TABS = ['dashboard', 'tools', 'logs', 'chat', 'agents']

const state = {
  agents: [],
  activeId: null,
  token: '',
  tab: 'dashboard',
  ws: null,
  wsStatus: 'disconnected',
  reconnectDelay: 800,
  snapshot: null,
  logs: [],
  logFilter: '',
  toolCatalog: [],
  toolQuery: '',
  activeToolName: null,
  toolResult: null,
  pending: false,
  chat: [],
  health: {},
  rafQueued: false,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function $(id) {
  return document.getElementById(id)
}

function nowIso() {
  return new Date().toISOString()
}

// ─── Config / agents ────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_AGENTS)
    state.agents = raw ? JSON.parse(raw) : []
  } catch (_e) {
    state.agents = []
  }
  if (!Array.isArray(state.agents) || state.agents.length === 0) {
    state.agents = [{ id: 'local', label: 'Local agent', url: location.origin }]
  }
  const active = localStorage.getItem(LS_ACTIVE)
  state.activeId = active && state.agents.some((a) => a.id === active) ? active : state.agents[0].id
  state.token = localStorage.getItem(LS_TOKEN) || ''
}

function persistAgents() {
  localStorage.setItem(LS_AGENTS, JSON.stringify(state.agents))
  localStorage.setItem(LS_ACTIVE, state.activeId)
}

function persistToken() {
  if (state.token) localStorage.setItem(LS_TOKEN, state.token)
  else localStorage.removeItem(LS_TOKEN)
}

function activeAgent() {
  if (!state.agents.length) return null
  const found = state.agents.filter((a) => a.id === state.activeId)[0]
  return found || state.agents[0]
}

function baseUrl() {
  const agent = activeAgent()
  return (agent ? agent.url : location.origin).replace(/[/]+$/, '')
}

function wsUrl() {
  return baseUrl().replace(/^http/, 'ws')
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {}
}

function api(path, options) {
  options = options || {}
  const headers = Object.assign({}, options.headers || {}, authHeaders())
  return fetch(baseUrl() + path, Object.assign({}, options, { headers: headers })).then((res) =>
    res.text().then((text) => {
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch (_e) {
        body = { raw: text }
      }
      return { ok: res.ok, status: res.status, body: body }
    }),
  )
}

// ─── WebSocket ──────────────────────────────────────────────────────────────

function connectWs() {
  if (state.ws) {
    try {
      state.ws.onclose = null
      state.ws.close()
    } catch (_e) {}
    state.ws = null
  }
  state.wsStatus = 'connecting'
  render()
  let ws
  try {
    ws = new WebSocket(wsUrl())
  } catch (_e) {
    scheduleReconnect()
    return
  }
  state.ws = ws
  ws.onopen = () => {
    state.wsStatus = 'connected'
    state.reconnectDelay = 800
    if (state.token) sendWs({ type: 'auth', payload: { token: state.token } })
    sendWs({ type: 'subscribe:logs', payload: {} })
    sendWs({ type: 'subscribe:state', payload: {} })
    render()
  }
  ws.onmessage = handleWsMessage
  ws.onclose = () => {
    state.wsStatus = 'disconnected'
    state.ws = null
    render()
    scheduleReconnect()
  }
  ws.onerror = () => {}
}

function scheduleReconnect() {
  const delay = state.reconnectDelay
  state.reconnectDelay = Math.min(state.reconnectDelay * 1.6, 8000)
  setTimeout(() => {
    if (!state.ws) connectWs()
  }, delay)
}

function sendWs(msg) {
  if (state.ws?.readyState !== 1) return false
  msg.id = msg.id || `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  msg.timestamp = Date.now()
  state.ws.send(JSON.stringify(msg))
  return true
}

function handleWsMessage(event) {
  let msg
  try {
    msg = JSON.parse(event.data)
  } catch (_e) {
    return
  }
  if (msg.type === 'tool:catalog') {
    state.toolCatalog = msg.payload?.tools || []
    if (state.tab === 'tools') render()
  } else if (msg.type === 'state:snapshot') {
    state.snapshot = msg.payload
    if (state.tab === 'dashboard') queueRender()
  } else if (msg.type === 'log:entry') {
    state.logs.push(msg.payload)
    if (state.logs.length > MAX_LOGS) state.logs.shift()
    if (state.tab === 'logs') queueRender()
  } else if (msg.type === 'ack') {
    if (msg.payload?.reply) {
      state.chat.push({ sender: 'agent', text: msg.payload.reply, ts: nowIso() })
      if (state.tab === 'chat') render()
    }
  } else if (msg.type === 'error') {
    state.chat.push({ sender: 'system', text: `Error: ${msg.payload?.message}`, ts: nowIso() })
    if (state.tab === 'chat') render()
  }
}

function queueRender() {
  if (state.rafQueued) return
  state.rafQueued = true
  requestAnimationFrame(() => {
    state.rafQueued = false
    render()
  })
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function render() {
  const active = document.activeElement
  const focusId = active?.id ? active.id : null
  let caret = null
  try {
    caret = active && active.selectionStart != null ? active.selectionStart : null
  } catch (_e) {
    caret = null
  }

  renderTopbar()
  renderTabs()
  $('view').innerHTML = viewHtml()
  bindView()

  if (focusId) {
    const el = $(focusId)
    if (el?.focus) {
      el.focus()
      try {
        if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret)
      } catch (_e) {}
    }
  }
}

function renderTopbar() {
  const agent = activeAgent()
  const statusClass =
    state.wsStatus === 'connected'
      ? 'status-connected'
      : state.wsStatus === 'connecting'
        ? 'status-connecting'
        : 'status-disconnected'
  const options = state.agents
    .map((a) => `<option value="${esc(a.id)}"${a.id === state.activeId ? ' selected' : ''}>${esc(a.label)}</option>`)
    .join('')
  $('topbar').innerHTML =
    '<h1>Etemaro Agent Console</h1>' +
    '<select id="agent-select" title="Active agent">' +
    options +
    '</select>' +
    '<span><span class="status-dot ' +
    statusClass +
    '"></span>' +
    esc(state.wsStatus) +
    '</span>' +
    '<span class="spacer"></span>' +
    '<span class="muted small">' +
    esc(agent ? agent.url : '') +
    '</span>'
  $('agent-select').addEventListener('change', (e) => {
    state.activeId = e.target.value
    persistAgents()
    state.snapshot = null
    state.logs = []
    state.toolCatalog = []
    state.activeToolName = null
    state.toolResult = null
    connectWs()
  })
}

function renderTabs() {
  $('tabs').innerHTML = TABS.map(
    (tab) => `<button data-tab="${tab}"${state.tab === tab ? ' class="active"' : ''}>${tab}</button>`,
  ).join('')
  Array.prototype.forEach.call($('tabs').querySelectorAll('button'), (btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.getAttribute('data-tab')
      if (state.tab === 'tools') loadTools()
      if (state.tab === 'agents') refreshHealth()
      render()
    })
  })
}

function viewHtml() {
  if (state.tab === 'tools') return toolsView()
  if (state.tab === 'logs') return logsView()
  if (state.tab === 'chat') return chatView()
  if (state.tab === 'agents') return agentsView()
  return dashboardView()
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

function fmtUsd(n) {
  const v = Number(n || 0)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2)
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString()
}

function dashboardView() {
  const s = state.snapshot
  if (!s) {
    return '<div class="card"><h2>Status</h2><p class="muted">Waiting for the agent state snapshot. Is the daemon running and reachable?</p></div>'
  }
  const pnlClass = Number(s.totalPnlUsd) >= 0 ? 'pos' : 'neg'
  const positions = s.positions || []
  const rows = positions
    .map((p) => {
      const pnl = Number(p.pnlUsd || 0)
      const cls = pnl >= 0 ? 'pos' : 'neg'
      return (
        '<tr>' +
        '<td>' +
        esc(p.tokenSymbol || '—') +
        '</td>' +
        '<td class="small muted">' +
        esc((p.positionAddress || '').slice(0, 10)) +
        '</td>' +
        '<td class="num ' +
        cls +
        '">' +
        fmtUsd(p.pnlUsd) +
        '</td>' +
        '<td class="num">' +
        (p.pnlPct == null ? '—' : `${Number(p.pnlPct).toFixed(2)}%`) +
        '</td>' +
        '<td class="num">' +
        fmtUsd(p.valueUsd) +
        '</td>' +
        '</tr>'
      )
    })
    .join('')

  return (
    '<div class="metrics">' +
    '<div class="metric"><div class="label">Total PnL</div><div class="value ' +
    pnlClass +
    '">' +
    fmtUsd(s.totalPnlUsd) +
    '</div></div>' +
    '<div class="metric"><div class="label">Open positions</div><div class="value">' +
    positions.length +
    '</div></div>' +
    '<div class="metric"><div class="label">Busy</div><div class="value">' +
    (s.busy ? 'yes' : 'no') +
    '</div></div>' +
    '<div class="metric"><div class="label">Next screening</div><div class="value small">' +
    fmtTime(s.nextScreenAt) +
    '</div></div>' +
    '<div class="metric"><div class="label">Next management</div><div class="value small">' +
    fmtTime(s.nextManageAt) +
    '</div></div>' +
    '</div>' +
    '<div class="card" style="margin-top:12px"><h2>Positions</h2>' +
    (positions.length
      ? `<table><thead><tr><th>Pair</th><th>Position</th><th class="num">PnL</th><th class="num">PnL %</th><th class="num">Value</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">No open positions.</p>') +
    '</div>'
  )
}

// ─── Tools ──────────────────────────────────────────────────────────────────

function loadTools() {
  if (state.toolCatalog.length) return
  api('/api/tools')
    .then((res) => {
      if (res.ok && res.body && Array.isArray(res.body.tools)) {
        state.toolCatalog = res.body.tools
        if (state.tab === 'tools') render()
      }
    })
    .catch(() => {})
}

function filteredTools() {
  const q = state.toolQuery.trim().toLowerCase()
  if (!q) return state.toolCatalog
  return state.toolCatalog.filter((t) => `${t.name} ${t.description}`.toLowerCase().indexOf(q) !== -1)
}

function toolsView() {
  const list = filteredTools()
    .map((tool) => {
      const write = tool.isProtected
        ? '<span class="badge badge-write">write</span>'
        : '<span class="badge badge-read">read</span>'
      return (
        '<div class="tool-item' +
        (state.activeToolName === tool.name ? ' active' : '') +
        '" data-tool="' +
        esc(tool.name) +
        '">' +
        '<div class="name">' +
        esc(tool.name) +
        write +
        '</div>' +
        '<div class="desc">' +
        esc(tool.description) +
        '</div>' +
        '</div>'
      )
    })
    .join('')

  return (
    '<div class="tool-layout">' +
    '<div class="card"><h2>Tools (' +
    state.toolCatalog.length +
    ')</h2>' +
    '<input id="tool-search" placeholder="Search tools" value="' +
    esc(state.toolQuery) +
    '">' +
    '<div class="tool-list" style="margin-top:8px">' +
    (list || '<p class="muted small">No tools loaded. Is the daemon running?</p>') +
    '</div>' +
    '</div>' +
    '<div class="card">' +
    toolDetailHtml() +
    '</div>' +
    '</div>'
  )
}

function toolDetailHtml() {
  const tool = state.toolCatalog.filter((t) => t.name === state.activeToolName)[0]
  if (!tool) return '<h2>Tool</h2><p class="muted">Select a tool on the left to see its parameters and run it.</p>'

  const props = tool.parameters?.properties || {}
  const required = tool.parameters?.required || []
  const fields = Object.keys(props)
    .map((name) => fieldHtml(name, props[name], required.indexOf(name) !== -1))
    .join('')

  const writeBanner = tool.isProtected
    ? '<p class="warn">This tool changes state. Confirm before running.</p>' +
      '<label class="field"><span><input type="checkbox" id="tf-confirm"> I understand and want to run it</span></label>'
    : ''

  let result = ''
  if (state.pending) result = '<p class="muted">Running…</p>'
  else if (state.toolResult) result = resultHtml(state.toolResult)

  return (
    '<h2>' +
    esc(tool.name) +
    '</h2>' +
    '<p class="muted small">' +
    esc(tool.description) +
    '</p>' +
    '<form id="tool-form" style="margin-top:12px">' +
    fields +
    writeBanner +
    '<button class="primary" type="submit">Run tool</button></form>' +
    '<div style="margin-top:14px">' +
    result +
    '</div>'
  )
}

function fieldHtml(name, schema, isRequired) {
  schema = schema || {}
  const type = schema.type || 'string'
  const id = `tf-${name}`
  const label = `<label class="field"><span>${esc(name)}${isRequired ? ' <span class="error">*</span>' : ''}</span>`
  const hint = schema.description ? `<div class="hint">${esc(schema.description)}</div>` : ''
  let input

  if (Array.isArray(schema.enum)) {
    input = `<select id="${esc(id)}">${schema.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`
  } else if (type === 'boolean') {
    input = `<input type="checkbox" id="${esc(id)}">`
  } else if (type === 'number' || type === 'integer') {
    input = `<input type="number" step="any" id="${esc(id)}">`
  } else if (type === 'array') {
    input = `<input type="text" id="${esc(id)}" placeholder="comma-separated">`
  } else if (type === 'object') {
    input = `<textarea id="${esc(id)}" placeholder="{}"></textarea>`
  } else {
    input = `<input type="text" id="${esc(id)}">`
  }

  return `${label + input + hint}</label>`
}

function resultHtml(res) {
  const title = res.status ? `HTTP ${res.status}` : 'Error'
  const cls = res.status >= 200 && res.status < 300 ? '' : 'error'
  return `<div class="${cls} small">${esc(title)}</div><pre class="result">${esc(JSON.stringify(res.body, null, 2))}</pre>`
}

function collectToolArgs(tool) {
  const props = tool.parameters?.properties || {}
  const args = {}
  Object.keys(props).forEach((name) => {
    const el = $(`tf-${name}`)
    if (!el) return
    const schema = props[name] || {}
    const type = schema.type || 'string'
    if (type === 'boolean') {
      args[name] = !!el.checked
      return
    }
    const raw = el.value
    if (raw === '' || raw == null) return
    if (type === 'number' || type === 'integer') {
      args[name] = Number(raw)
    } else if (type === 'array') {
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
      const itemType = schema.items?.type
      args[name] = itemType === 'number' || itemType === 'integer' ? parts.map(Number) : parts
    } else if (type === 'object') {
      args[name] = JSON.parse(raw)
    } else {
      args[name] = raw
    }
  })
  return args
}

function invokeTool(tool) {
  let args
  try {
    args = collectToolArgs(tool)
  } catch (e) {
    state.toolResult = { status: 0, body: { error: { message: `Invalid argument JSON: ${e.message}` } } }
    render()
    return
  }
  const confirmEl = $('tf-confirm')
  const confirm = confirmEl ? !!confirmEl.checked : false
  state.pending = true
  state.toolResult = null
  render()
  api('/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tool.name, args: args, confirm: confirm }),
  })
    .then((res) => {
      state.pending = false
      state.toolResult = { status: res.status, body: res.body }
      render()
    })
    .catch((err) => {
      state.pending = false
      state.toolResult = { status: 0, body: { error: { message: String(err) } } }
      render()
    })
}

// ─── Logs ───────────────────────────────────────────────────────────────────

function logsView() {
  const q = state.logFilter.trim().toLowerCase()
  const entries = q
    ? state.logs.filter((l) => `${l.category} ${l.message}`.toLowerCase().indexOf(q) !== -1)
    : state.logs
  const lines = entries
    .slice(-400)
    .map(
      (l) =>
        '<div class="log-line"><span class="ts">' +
        esc((l.ts || '').slice(11, 19)) +
        '</span> ' +
        '<span class="cat">' +
        esc(l.category || '') +
        '</span> ' +
        esc(l.message || '') +
        '</div>',
    )
    .join('')
  return (
    '<div class="card"><h2>Logs (' +
    state.logs.length +
    ')</h2>' +
    '<input id="log-filter" placeholder="Filter logs" value="' +
    esc(state.logFilter) +
    '" style="width:100%">' +
    '<div id="log-list" style="margin-top:8px">' +
    (lines || '<p class="muted small">No logs yet.</p>') +
    '</div>' +
    '</div>'
  )
}

// ─── Chat ───────────────────────────────────────────────────────────────────

function chatView() {
  const bubbles = state.chat.map((m) => `<div class="bubble ${esc(m.sender)}">${esc(m.text)}</div>`).join('')
  return (
    '<div class="card"><h2>Chat with the agent</h2>' +
    '<div class="chat-log" id="chat-log">' +
    (bubbles || '<p class="muted small">No messages yet. Ask e.g. "what is the current status?".</p>') +
    '</div>' +
    '<div class="row"><input id="chat-input" placeholder="Ask the agent…" style="flex:1">' +
    '<button class="primary" id="chat-send" type="button">Send</button></div></div>'
  )
}

function sendChat() {
  const input = $('chat-input')
  if (!input) return
  const text = input.value.trim()
  if (!text) return
  if (!sendWs({ type: 'command:chat', payload: { prompt: text } })) {
    state.chat.push({ sender: 'system', text: 'Not connected to the agent.', ts: nowIso() })
    render()
    return
  }
  state.chat.push({ sender: 'user', text: text, ts: nowIso() })
  input.value = ''
  render()
}

// ─── Agents ─────────────────────────────────────────────────────────────────

function refreshHealth() {
  state.agents.forEach((agent) => {
    fetch(`${agent.url.replace(/[/]+$/, '')}/api/health`)
      .then((r) => r.json())
      .then((body) => {
        state.health[agent.id] = { ok: true, body: body }
      })
      .catch(() => {
        state.health[agent.id] = { ok: false }
      })
      .then(() => {
        if (state.tab === 'agents') render()
      })
  })
}

function agentsView() {
  const rows = state.agents
    .map((agent) => {
      const health = state.health[agent.id]
      const dot = health ? (health.ok ? 'status-connected' : 'status-disconnected') : 'status-connecting'
      const detail =
        health?.ok && health.body ? `${esc(health.body.agentId || '')} — ${health.body.tools} tools` : 'unknown'
      return (
        '<div class="agent-row">' +
        '<span class="status-dot ' +
        dot +
        '"></span>' +
        '<div style="flex:1"><div>' +
        esc(agent.label) +
        (agent.id === state.activeId ? ' <span class="badge badge-read">active</span>' : '') +
        '</div>' +
        '<div class="url">' +
        esc(agent.url) +
        '</div><div class="muted small">' +
        detail +
        '</div></div>' +
        '<button class="ghost" data-use="' +
        esc(agent.id) +
        '" type="button">Use</button>' +
        (state.agents.length > 1
          ? `<button class="danger" data-del="${esc(agent.id)}" type="button">Remove</button>`
          : '') +
        '</div>'
      )
    })
    .join('')

  return (
    '<div class="card"><h2>Agents</h2>' +
    rows +
    '<div class="row" style="margin-top:12px">' +
    '<input id="new-agent-label" placeholder="Label" style="width:160px">' +
    '<input id="new-agent-url" placeholder="http://127.0.0.1:8766" style="flex:1">' +
    '<button class="primary" id="add-agent" type="button">Add agent</button>' +
    '</div></div>' +
    '<div class="card"><h2>Access token</h2>' +
    '<p class="muted small">Only needed when the daemon config sets connection.ipcToken.</p>' +
    '<div class="row"><input id="token-input" type="password" placeholder="ipcToken" value="' +
    esc(state.token) +
    '" style="flex:1">' +
    '<button class="primary" id="save-token" type="button">Save</button></div></div>'
  )
}

function addAgent() {
  const label = $('new-agent-label')?.value || ''
  let url = $('new-agent-url')?.value || ''
  url = url.trim().replace(/[/]+$/, '')
  if (!url) return
  const id = `agent-${Date.now()}`
  state.agents.push({ id: id, label: label.trim() || url, url: url })
  state.activeId = id
  persistAgents()
  state.health = {}
  connectWs()
  refreshHealth()
}

// ─── Bindings ───────────────────────────────────────────────────────────────

function bindView() {
  if (state.tab === 'tools') {
    const search = $('tool-search')
    if (search) {
      search.addEventListener('input', () => {
        state.toolQuery = search.value
        render()
      })
    }
    Array.prototype.forEach.call(document.querySelectorAll('.tool-item'), (item) => {
      item.addEventListener('click', () => {
        state.activeToolName = item.getAttribute('data-tool')
        state.toolResult = null
        render()
      })
    })
    const form = $('tool-form')
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const tool = state.toolCatalog.filter((t) => t.name === state.activeToolName)[0]
        if (tool) invokeTool(tool)
      })
    }
  } else if (state.tab === 'logs') {
    const filter = $('log-filter')
    if (filter)
      filter.addEventListener('input', () => {
        state.logFilter = filter.value
        render()
      })
  } else if (state.tab === 'chat') {
    const send = $('chat-send')
    if (send) send.addEventListener('click', sendChat)
    const input = $('chat-input')
    if (input)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChat()
      })
    const log = $('chat-log')
    if (log) log.scrollTop = log.scrollHeight
  } else if (state.tab === 'agents') {
    const add = $('add-agent')
    if (add) add.addEventListener('click', addAgent)
    const saveToken = $('save-token')
    if (saveToken) {
      saveToken.addEventListener('click', () => {
        state.token = $('token-input')?.value || ''
        persistToken()
        connectWs()
        render()
      })
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-use]'), (btn) => {
      btn.addEventListener('click', () => {
        state.activeId = btn.getAttribute('data-use')
        persistAgents()
        state.snapshot = null
        state.toolCatalog = []
        state.logs = []
        connectWs()
        render()
      })
    })
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), (btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del')
        state.agents = state.agents.filter((a) => a.id !== id)
        if (state.activeId === id) state.activeId = state.agents[0].id
        persistAgents()
        state.health = {}
        connectWs()
        render()
      })
    })
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────

function init() {
  loadConfig()
  try {
    const tokenParam = new URLSearchParams(location.search).get('token')
    if (tokenParam) {
      state.token = tokenParam
      persistToken()
    }
  } catch (_e) {}
  render()
  connectWs()
  loadTools()
  refreshHealth()
  setInterval(refreshHealth, 15000)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
