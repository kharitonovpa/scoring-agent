'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export function RetryAnalysis({ sessionId, auto = false }: { sessionId: string; auto?: boolean }) {
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const fired = useRef(false)

  const run = useCallback(async () => {
    setState('running')
    setMessage(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        location.reload()
        return
      }
      const body = await res.json().catch(() => ({}))
      setMessage(body.error ?? 'Не получилось.')
      setState('failed')
    } catch {
      setMessage('Сеть не отвечает.')
      setState('failed')
    }
  }, [sessionId])

  useEffect(() => {
    if (!auto || fired.current) return
    fired.current = true
    void run()
  }, [auto, run])

  return (
    <div className="mt-4">
      <button
        onClick={run}
        disabled={state === 'running'}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {state === 'running' ? 'Анализирую…' : 'Повторить анализ'}
      </button>
      {state === 'failed' && <p className="mt-2 text-sm text-red-700">{message}</p>}
    </div>
  )
}
