import Link from 'next/link'
import { loadRole } from '@/lib/roles'

const ROLE = loadRole('unimatch-default')

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16 sm:px-6">
      <h1 className="text-[2rem] font-semibold tracking-tight">Unimatch screening</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        A {ROLE.minutes}-minute first-round call in English, run by our AI assistant. You will need
        a microphone and a quiet room. A human recruiter reads the result and decides what happens
        next.
      </p>
      <Link href="/interview" className="btn btn-primary mt-8">
        Start the interview
      </Link>
      <p className="mt-14 border-t border-line pt-6 text-sm text-ink-faint">
        Recruiters:{' '}
        <Link href="/dashboard" className="text-accent underline underline-offset-2">
          open the dashboard
        </Link>
      </p>
    </main>
  )
}
