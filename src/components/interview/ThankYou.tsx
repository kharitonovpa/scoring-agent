export function ThankYou({ sessionId }: { sessionId: string | null }) {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  return (
    <section className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">Thank you</h1>
      <p className="text-neutral-600">
        That is the whole screening. A Unimatch recruiter reviews the conversation and follows up by
        email.
      </p>
      {demo && sessionId && (
        <p className="rounded border border-dashed border-neutral-300 p-4 text-sm">
          Demo build: the recruiter card is at{' '}
          <a className="underline" href={`/card/${sessionId}`}>
            /card/{sessionId}
          </a>
          . In production a candidate would not see this link.
        </p>
      )}
    </section>
  )
}
