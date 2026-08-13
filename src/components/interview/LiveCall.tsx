'use client'
import { useEffect, useRef } from 'react'
import type { Turn } from '@/lib/types'

export function LiveCall({
  turns,
  muted,
  onToggleMute,
  onEnd,
}: {
  turns: Turn[]
  muted: boolean
  onToggleMute: () => void
  onEnd: () => void
}) {
  const tail = useRef<HTMLDivElement>(null)
  useEffect(() => tail.current?.scrollIntoView({ behavior: 'smooth' }), [turns.length])

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-5 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span
          className={
            muted ? 'h-3 w-3 rounded-full bg-amber-500' : 'h-3 w-3 animate-pulse rounded-full bg-red-500'
          }
        />
        <h1 className="text-xl font-semibold tracking-tight">
          {muted ? 'Your microphone is off' : 'The interview is running'}
        </h1>
      </div>

      {/* Забытый выключенный микрофон — главный способ испортить себе интервью,
          поэтому состояние сказано словами, а не только цветом точки. */}
      {muted ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 leading-relaxed text-amber-900">
          Nobody can hear you right now. Turn the microphone back on when you are ready to answer —
          the conversation is still open and nothing is lost.
        </p>
      ) : (
        <p className="leading-relaxed text-ink-soft">
          Just talk normally. Take your time before answering — pauses are fine and are not held
          against you.
        </p>
      )}

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

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <button
          onClick={onToggleMute}
          aria-pressed={muted}
          className={muted ? 'btn btn-primary' : 'btn btn-quiet'}
        >
          <span aria-hidden>{muted ? '🎙' : '🔇'}</span>
          {muted ? 'Turn the microphone on' : 'Mute the microphone'}
        </button>
        <button onClick={onEnd} className="btn btn-quiet">
          End the interview
        </button>
      </div>
    </section>
  )
}
