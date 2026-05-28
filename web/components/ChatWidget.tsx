'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const EXAMPLES = [
  '지금 어떤 카테고리가 가장 먹거리야?',
  '부정 리뷰 급증한 상품 있어? 원인은?',
  '선케어 시장에서 우리 포지션 어때?',
  '신제품 중 가능성 있는 거 있어?',
]

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, messages])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const next: Message[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-10) }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply || data.error || '응답을 받지 못했습니다.',
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* 채팅 패널 */}
      {open && (
        <div className="flex flex-col w-80 sm:w-96 rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
          style={{ height: '520px' }}>

          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold text-text-primary">AI 인사이트</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded"
              aria-label="닫기"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 ? (
              <div className="space-y-4">
                <p className="text-xs text-text-tertiary leading-relaxed">
                  수집된 리뷰·랭킹·프로모션 데이터를 기반으로 답변합니다.
                </p>
                <div className="space-y-2">
                  <p className="text-xs text-text-tertiary font-medium">예시 질문</p>
                  {EXAMPLES.map(ex => (
                    <button
                      key={ex}
                      onClick={() => send(ex)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-border
                                 text-text-secondary hover:bg-accent-bg hover:border-accent-border
                                 hover:text-text-primary transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-accent text-white rounded-br-sm'
                        : 'bg-background border border-border text-text-primary rounded-bl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-background border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 입력창 */}
          <div className="border-t border-border px-3 py-3 bg-background">
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="질문을 입력하세요..."
                rows={1}
                disabled={loading}
                className="flex-1 resize-none text-sm bg-surface border border-border rounded-xl
                           px-3 py-2 text-text-primary placeholder:text-text-tertiary
                           focus:outline-none focus:border-accent
                           disabled:opacity-50 transition-colors"
                style={{ maxHeight: '96px' }}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="shrink-0 w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center
                           hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                aria-label="전송"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 토글 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-14 h-14 rounded-full bg-accent text-white shadow-lg
                   flex items-center justify-center
                   hover:opacity-90 active:scale-95 transition-all"
        aria-label="AI 인사이트 채팅"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
    </div>
  )
}
