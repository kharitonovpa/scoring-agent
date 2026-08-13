export function ThankYou({ sessionId }: { sessionId: string | null }) {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  return (
    <section className="mx-auto max-w-xl px-5 py-16 text-center sm:px-6">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-2xl text-accent">
        ✓
      </div>
      <h1 className="mt-6 text-[1.75rem] font-semibold tracking-tight">Thank you</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-soft">
        That is the whole screening. A Unimatch recruiter reviews the conversation and follows up by
        email.
      </p>
      {demo && sessionId && (
        <p className="mt-10 rounded-card border border-dashed border-line-strong p-5 text-left text-sm leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">Demo build.</span> The recruiter card is at{' '}
          <a className="text-accent underline underline-offset-2" href={`/card/${sessionId}`}>
            /card/{sessionId}
          </a>
          . In production a candidate would not see this link.
        </p>
      )}
    </section>
  )
}
