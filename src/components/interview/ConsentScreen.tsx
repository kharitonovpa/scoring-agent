'use client'
import { useState } from 'react'

export function ConsentScreen({ onReady }: { onReady: (name: string) => void }) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canStart = name.trim().length > 1 && agreed

  return (
    <section className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Before we start</h1>
      <p className="text-neutral-600">
        This is a first-round screening call with Unimatch. It runs in English and takes about ten
        minutes. You will talk to an AI assistant, and a human recruiter reads the result afterwards.
      </p>
      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          placeholder="Alex Smith"
        />
      </label>
      <label className="flex gap-3 rounded border border-neutral-300 p-4">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-neutral-700">
          I agree that this conversation is recorded and transcribed so a Unimatch recruiter can
          review it. The recruiter makes the hiring decision, not the assistant.
        </span>
      </label>
      <button
        disabled={!canStart}
        onClick={() => onReady(name.trim())}
        className="rounded bg-black px-5 py-2.5 text-white disabled:opacity-40"
      >
        Continue
      </button>
    </section>
  )
}
