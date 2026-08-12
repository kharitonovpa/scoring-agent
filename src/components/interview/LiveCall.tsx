'use client'
import { useEffect, useRef } from 'react'
import type { Turn } from '@/lib/types'

export function LiveCall({ turns, onEnd }: { turns: Turn[]; onEnd: () => void }) {
  const tail = useRef<HTMLDivElement>(null)
  useEffect(() => tail.current?.scrollIntoView({ behavior: 'smooth' }), [turns.length])

  return (
    <section className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <h1 className="text-xl font-semibold">The interview is running</h1>
      </div>
      <p className="text-neutral-600">
        Just talk normally. Take your time before answering — pauses are fine and are not held
        against you.
      </p>
      <ul className="space-y-3">
        {turns.map((t) => (
          <li key={t.id} className={t.speaker === 'agent' ? 'text-neutral-500' : 'font-medium'}>
            <span className="mr-2 text-xs uppercase tracking-wide text-neutral-400">
              {t.speaker === 'agent' ? 'Recruiter' : 'You'}
            </span>
            {t.text}
          </li>
        ))}
      </ul>
      <div ref={tail} />
      <button onClick={onEnd} className="rounded border border-neutral-300 px-5 py-2.5">
        End the interview
      </button>
    </section>
  )
}
