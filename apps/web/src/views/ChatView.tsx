import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../lib/ipc'

export function ChatView({ chat, onSend }: { chat: ChatMessage[]; onSend: (text: string) => boolean }) {
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const submit = () => {
    const value = text.trim()
    if (!value) return
    if (onSend(value)) setText('')
  }

  return (
    <section className="card">
      <h2>Chat with the agent</h2>
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 ? (
          <p className="muted small">No messages yet. Ask e.g. "what is the current status?".</p>
        ) : (
          chat.map((m) => (
            <div className={`bubble ${m.sender}`} key={m.id}>
              {m.text}
            </div>
          ))
        )}
      </div>
      <div className="row">
        <input
          value={text}
          placeholder="Ask the agent…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" className="primary" onClick={submit}>
          Send
        </button>
      </div>
    </section>
  )
}
