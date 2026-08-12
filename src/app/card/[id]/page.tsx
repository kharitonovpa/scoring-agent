import { notFound } from 'next/navigation'
import {
  DeliveryBlockView,
  Disclaimer,
  FactsBlock,
  LanguageBlockView,
  StructureBlockView,
} from '@/components/card/CardSections'
import { QuoteAudioProvider } from '@/components/card/QuoteAudioProvider'
import { RetryAnalysis } from '@/components/card/RetryAnalysis'
import { getSession } from '@/lib/db'

const STATUS: Record<string, string> = {
  live: 'Интервью идёт прямо сейчас',
  interrupted: 'Интервью было прервано',
  analyzing: 'Анализ ещё идёт',
  analyzed: 'Готово',
  failed: 'Анализ не удался',
}

// Карточка перестраивается после повторного анализа, поэтому кеш здесь только мешает.
export const dynamic = 'force-dynamic'

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession(id)
  if (!session) notFound()

  const minutes = session.metrics ? Math.round(session.metrics.durationSec / 60) : null
  const ctx = { turns: session.transcript, audioOffsetSec: session.audioOffsetSec }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{session.candidateName}</h1>
        <p className="text-sm text-neutral-600">
          {session.roleId} · {new Date(session.startedAt).toLocaleString('ru-RU')}
          {minutes !== null && ` · ${minutes} мин`} · {STATUS[session.status] ?? session.status}
        </p>
        {session.status === 'interrupted' && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            Разговор прервался до конца. Карточка построена по тому, что успело прозвучать — не все
            вопросы были заданы.
          </p>
        )}
      </header>

      <QuoteAudioProvider audioUrl={session.audioUrl}>
        {!session.card ? (
          <section className="rounded-lg border border-neutral-200 p-5">
            <p className="text-sm text-neutral-700">
              {session.status === 'failed'
                ? 'Анализ упал. Данные разговора сохранены — можно попробовать снова.'
                : 'Карточка ещё не готова.'}
            </p>
            {/* Сетка безопасности: обычно анализ уже отработал на сервере при завершении
                разговора. Если по какой-то причине карточки нет, запускаем сами. */}
            <RetryAnalysis sessionId={session.id} auto={session.status !== 'failed'} />
          </section>
        ) : (
          <>
            <FactsBlock card={session.card} ctx={ctx} />
            <StructureBlockView card={session.card} ctx={ctx} />
            <LanguageBlockView card={session.card} ctx={ctx} />
            <DeliveryBlockView card={session.card} ctx={ctx} />
            <Disclaimer dropped={session.card.droppedClaims} />
          </>
        )}
      </QuoteAudioProvider>

      {session.audioUrl && (
        <details className="rounded-lg border border-neutral-200 p-5">
          <summary className="cursor-pointer font-medium">Полная запись</summary>
          {/* Здесь обычный плеер уместен: файл прошёл ремукс, поэтому длительность
              показывается и перемотка работает. Фрагменты цитат играются иначе — см.
              QuoteAudioProvider. */}
          <audio controls preload="metadata" src={session.audioUrl} className="mt-3 w-full" />
        </details>
      )}

      <details className="rounded-lg border border-neutral-200 p-5">
        <summary className="cursor-pointer font-medium">Полный транскрипт</summary>
        <ul className="mt-3 space-y-2 text-sm">
          {session.transcript.map((t) => (
            <li key={t.id} className={t.speaker === 'agent' ? 'text-neutral-500' : ''}>
              <span className="mr-2 text-xs text-neutral-400">{t.tStart.toFixed(1)}с</span>
              <span className="mr-2 text-xs uppercase text-neutral-400">
                {t.speaker === 'agent' ? 'агент' : 'кандидат'}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}
