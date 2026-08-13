'use client'
import { useState } from 'react'

export function ConsentScreen({ onReady }: { onReady: (name: string) => void }) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canStart = name.trim().length > 1 && agreed

  return (
    <section className="mx-auto max-w-xl px-5 py-12 sm:px-6">
      <h1 className="text-[1.75rem] font-semibold tracking-tight">Before we start</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        This is a first-round screening call with Unimatch. It runs in English and takes about ten
        minutes. You will talk to an AI assistant, and a human recruiter reads the result afterwards.
      </p>

      {/* Человек на собеседовании и так волнуется — снимаем лишнюю неопределённость заранее. */}
      <ul className="mt-6 space-y-2.5 text-sm leading-relaxed text-ink-soft">
        {[
          'There are no trick questions — we ask about your experience and what you are looking for.',
          'Take your time before answering. Pauses are completely fine.',
          'If something goes wrong, just reload the page and start again.',
        ].map((line) => (
          <li key={line} className="flex gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            {line}
          </li>
        ))}
      </ul>

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

        <button disabled={!canStart} onClick={() => onReady(name.trim())} className="btn btn-primary w-full">
          Continue
        </button>
      </div>
    </section>
  )
}
