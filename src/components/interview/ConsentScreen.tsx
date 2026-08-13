'use client'
import { useState } from 'react'
import { loadRole } from '@/lib/roles'

const ROLE = loadRole('unimatch-default')
const QUESTIONS = ROLE.questions

export function ConsentScreen({ onReady }: { onReady: (name: string) => void }) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canStart = name.trim().length > 1 && agreed

  return (
    <section className="mx-auto max-w-xl px-5 py-12 sm:px-6">
      <h1 className="text-[1.75rem] font-semibold tracking-tight">Before we start</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        This is a first-round screening call with Unimatch. It runs in English and takes about{' '}
        {ROLE.minutes} minutes. You will talk to an AI assistant, and a human recruiter reads the
        result afterwards.
      </p>

      {/* Голосовое интервью без видимого прогресса — источник тревоги: человек не знает,
          о чём спросят и сколько осталось. Показываем список тем заранее. */}
      <div className="surface mt-7 p-6">
        <p className="text-sm font-medium">What we will talk about</p>
        <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-soft">
          {QUESTIONS.map((q, i) => (
            <li key={q.id} className="flex gap-3">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-medium text-accent">
                {i + 1}
              </span>
              {q.topic}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          No trick questions, and nothing you need to prepare. Take your time before answering —
          pauses are completely fine and are never held against you. If something goes wrong, reload
          the page and start again.
        </p>
      </div>

      <div className="surface mt-8 space-y-5 p-6">
        <label className="block">
          <span className="text-sm font-medium">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field mt-1.5"
            placeholder="Alex Smith"
          />
        </label>

        <label className="flex cursor-pointer gap-3 rounded-xl bg-paper p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-sm leading-relaxed text-ink-soft">
            I agree that this conversation is recorded and transcribed so a Unimatch recruiter can
            review it. The recruiter makes the hiring decision, not the assistant.
          </span>
        </label>

        {/* Согласие без права его отозвать согласием не является. Кандидат должен видеть,
            что запись можно потребовать удалить, и куда для этого писать. */}
        <p className="text-xs leading-relaxed text-ink-faint">
          The recording and transcript are kept only for this hiring process. You can ask us to
          delete them, or to send you a copy, by writing to{' '}
          <a className="text-accent underline underline-offset-2" href="mailto:privacy@unimatch.dev">
            privacy@unimatch.dev
          </a>
          .
        </p>

        <button disabled={!canStart} onClick={() => onReady(name.trim())} className="btn btn-primary w-full">
          Continue
        </button>
      </div>
    </section>
  )
}
