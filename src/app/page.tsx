import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-3xl font-semibold">Unimatch screening</h1>
      <p className="text-neutral-600">
        A ten-minute first-round call in English, run by our AI assistant. You will need a microphone
        and a quiet room. A human recruiter reads the result and decides what happens next.
      </p>
      <Link href="/interview" className="inline-block rounded bg-black px-5 py-2.5 text-white">
        Start the interview
      </Link>
      <p className="pt-8 text-sm text-neutral-500">
        Recruiters:{' '}
        <Link href="/dashboard" className="underline">
          open the dashboard
        </Link>
      </p>
    </main>
  )
}
