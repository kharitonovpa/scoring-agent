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
  const {
    phase,
    error,
    turns,
    sessionId,
    muted,
    questionId,
    nearingLimit,
    ranOutOfTime,
    toggleMute,
    start,
    end,
  } = useInterview()

  const problem = micError ?? error
  if (problem) {
    return (
      <section className="mx-auto max-w-xl px-5 py-16 sm:px-6">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">We hit a problem</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">{problem}</p>
        <button
          onClick={() => location.reload()}
          className="btn btn-primary mt-8"
        >
          Try again
        </button>
      </section>
    )
  }

  if (phase === 'done' || phase === 'ending') {
    return <ThankYou sessionId={sessionId} ranOutOfTime={ranOutOfTime} />
  }

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
    return <p className="mx-auto max-w-xl px-5 py-16 text-ink-soft sm:px-6">Connecting you to the recruiter…</p>
  }

  return (
    <LiveCall
      turns={turns}
      muted={muted}
      questionId={questionId}
      nearingLimit={nearingLimit}
      onToggleMute={toggleMute}
      onEnd={() => void end()}
    />
  )
}
