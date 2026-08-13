import type { RoleQuestion } from '@/lib/roles'

/**
 * Прогресс строится из списка вопросов роли, а не из зашитых в код названий: добавили
 * вопрос в конфиг — индикатор сам стал из пяти шагов.
 *
 * Пока агент не сообщил о первом вопросе, показываем вступление: в начале звонка он
 * представляется и рассказывает о роли, и это не «нулевой вопрос», а честная часть разговора.
 */
export function Progress({
  questions,
  questionId,
}: {
  questions: RoleQuestion[]
  questionId: string | null
}) {
  const index = questions.findIndex((q) => q.id === questionId)
  const current = index >= 0 ? questions[index] : null

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {current ? `Question ${index + 1} of ${questions.length}` : 'Getting started'}
        </p>
        <p className="text-sm text-ink-soft">{current ? current.topic : 'About the role'}</p>
      </div>
      <div className="mt-2.5 flex gap-1.5" role="presentation">
        {questions.map((q, i) => (
          <span
            key={q.id}
            className={`h-1.5 flex-1 rounded-full ${
              index >= 0 && i <= index ? 'bg-accent' : 'bg-line'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
