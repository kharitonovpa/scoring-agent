'use client'
import Link from 'next/link'

/**
 * Граница ошибки. Нужна не только ради текста: когда дерево падает, React размонтирует
 * ветку с интервью, а вместе с ней срабатывает уборка в useInterview — соединение
 * закрывается и голос агента замолкает. Без границы упавшая страница продолжала говорить.
 */
export default function InterviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="mx-auto max-w-xl px-5 py-16 sm:px-6">
      <h1 className="text-[1.75rem] font-semibold tracking-tight">The call stopped</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        Something went wrong on this page and the call was closed. Everything you said up to this
        point was saved, and a Unimatch recruiter will see it.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-quiet">
          Back to the start
        </Link>
      </div>
    </section>
  )
}
