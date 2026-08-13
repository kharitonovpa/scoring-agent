'use client'
import { useEffect, useRef } from 'react'
import type { Turn } from '@/lib/types'

export function LiveCall({ turns, onEnd }: { turns: Turn[]; onEnd: () => void }) {
  const tail = useRef<HTMLDivElement>(null)
  useEffect(() => tail.current?.scrollIntoView({ behavior: 'smooth' }), [turns.length])

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-5 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <h1 className="text-xl font-semibold tracking-tight">The interview is running</h1>
      </div>
      <p className="leading-relaxed text-ink-soft">
        Just talk normally. Take your time before answering — pauses are fine and are not held
        against you.
      </p>
      <ul className="space-y-3.5">
        {turns.map((t) => (
          <li key={t.id} className={t.speaker === 'agent' ? 'text-ink-soft' : 'text-ink'}>
            <span className="mr-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              {t.speaker === 'agent' ? 'Recruiter' : 'You'}
            </span>
            {t.text}
          </li>
        ))}
      </ul>
      <div ref={tail} />
      <button onClick={onEnd} className="btn btn-quiet">
        End the interview
      </button>
    </section>
  )
}
