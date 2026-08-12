'use client'
import { useState } from 'react'
import { ConsentScreen } from '@/components/interview/ConsentScreen'
import { LiveCall } from '@/components/interview/LiveCall'
import { MicCheck } from '@/components/interview/MicCheck'
import { ThankYou } from '@/components/interview/ThankYou'
import { useInterview } from '@/hooks/useInterview'

type Step = 'consent' | 'mic' | 'call'

export default function InterviewPage() {
  const [step, setStep] = useState<Step>('consent')
  const [name, setName] = useState('')
  const [micError, setMicError] = useState<string | null>(null)
  const { phase, error, turns, sessionId, start, end } = useInterview()

  const problem = micError ?? error
  if (problem) {
    return (
      <section className="mx-auto max-w-xl space-y-5 p-8">
        <h1 className="text-2xl font-semibold">We hit a problem</h1>
        <p className="text-neutral-700">{problem}</p>
        <button
          onClick={() => location.reload()}
          className="rounded bg-black px-5 py-2.5 text-white"
        >
          Try again
        </button>
      </section>
    )
  }

  if (phase === 'done' || phase === 'ending') return <ThankYou sessionId={sessionId} />

  if (step === 'consent') {
    return (
      <ConsentScreen
        onReady={(n) => {
          setName(n)
          setStep('mic')
        }}
      />
    )
  }

  if (step === 'mic') {
    return (
      <MicCheck
        onError={setMicError}
        onReady={() => {
          setStep('call')
          void start(name)
        }}
      />
    )
  }

  if (phase === 'connecting') {
    return <p className="p-8 text-neutral-600">Connecting you to the recruiter…</p>
  }

  return <LiveCall turns={turns} onEnd={() => void end()} />
}
