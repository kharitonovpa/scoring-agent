import { isInsufficient, type Card, type Metrics } from '@/lib/types'

/**
 * Верхний взгляд на кандидата за десять секунд.
 *
 * Собирается кодом из уже проверенных блоков и ничего нового не утверждает: каждая
 * строка — это пересчёт данных, прошедших сверку цитат. Отдельным запросом к модели
 * такую сводку делать нельзя: она была бы единственным местом в карточке, где написано
 * то, чего никто не проверял, — а именно от этого продукт и уходит.
 */

const ANSWERED_WEIGHT: Record<string, string> = {
  yes: 'по существу',
  partial: 'частично',
  off_topic: 'мимо вопроса',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
      <span className="w-40 shrink-0 text-sm text-ink-soft">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

export function SummaryBlock({ card, metrics }: { card: Card; metrics: Metrics | null }) {
  const coverage = card.structure.coverage
  const byAnswer = coverage.reduce<Record<string, number>>(
    (acc, c) => ({ ...acc, [c.answered]: (acc[c.answered] ?? 0) + 1 }),
    {},
  )

  // По каждому кейсу отдельно: с двумя примерами общий список «чего не хватает» ничего
  // рекрутеру не говорит — непонятно, в каком из них дыра.
  const examples = card.structure.examples.map((e) => ({
    label: e.questionLabel,
    missing: (
      [
        ['ситуация', e.situation.present],
        ['что сделал сам', e.action.present],
        ['результат', e.result.present],
      ] as const
    )
      .filter(([, present]) => !present)
      .map(([name]) => name),
  }))

  const missingFacts = card.facts.filter((f) => !f.value).map((f) => f.label.toLowerCase())

  const signals = isInsufficient(card.delivery) ? null : card.delivery.signals.length

  return (
    <section className="surface p-6 sm:p-7">
      <h2 className="text-[1.0625rem] font-semibold tracking-tight">Коротко</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
        Сводка пересчитана из блоков ниже — ничего нового здесь не утверждается. Каждое
        утверждение в карточке подкреплено цитатой из разговора,{' '}
        <span className="text-ink">а по цитате можно нажать и услышать этот фрагмент записи.</span>
      </p>

      <div className="mt-4 divide-y divide-line">
        <Row label="Английский">
          {isInsufficient(card.language) ? (
            <span className="text-ink-faint">данных не хватило для оценки</span>
          ) : (
            <span className="font-medium">
              {card.language.rangeLow}–{card.language.rangeHigh}
            </span>
          )}
        </Row>

        <Row label="Ответы на вопросы">
          <span className="font-medium">
            {byAnswer.yes ?? 0} из {coverage.length} по существу
          </span>
          {coverage.length > 0 && (
            <span className="ml-2 text-ink-soft">
              {(['partial', 'off_topic'] as const)
                .filter((k) => byAnswer[k])
                .map((k) => `${byAnswer[k]} ${ANSWERED_WEIGHT[k]}`)
                .join(', ')}
            </span>
          )}
        </Row>

        {examples.map((e) => (
          <Row key={e.label} label="Кейс">
            <span className="text-ink-soft">{e.label}: </span>
            {e.missing.length === 0 ? (
              <span className="font-medium">полный — ситуация, действие, результат</span>
            ) : (
              <>
                <span className="font-medium">не хватает: {e.missing.join(', ')}</span>
                <span className="ml-2 text-ink-soft">— переспросить на следующем звонке</span>
              </>
            )}
          </Row>
        ))}

        <Row label="Факты собраны">
          {missingFacts.length === 0 ? (
            <span className="font-medium">все {card.facts.length}</span>
          ) : (
            <span className="font-medium">
              {card.facts.length - missingFacts.length} из {card.facts.length}, не прозвучало:{' '}
              {missingFacts.join(', ')}
            </span>
          )}
        </Row>

        <Row label="Спросил сам">
          {card.curiosity.asked.length === 0 ? (
            <span className="text-ink-faint">вопросов не задавал</span>
          ) : (
            <span className="font-medium">
              {card.curiosity.asked.map((a) => a.topic).join(', ')}
            </span>
          )}
        </Row>

        <Row label="Манера речи">
          {signals === null ? (
            <span className="text-ink-faint">данных не хватило для оценки</span>
          ) : signals === 0 ? (
            <span className="font-medium">без замечаний</span>
          ) : (
            <span className="font-medium">
              {signals} {signals === 1 ? 'сигнал' : 'сигнала'} — посмотреть ниже
            </span>
          )}
        </Row>

        {metrics && (
          <Row label="Разговор">
            {Math.round(metrics.durationSec / 60)} мин, из них кандидат говорил{' '}
            {Math.round(metrics.candidateSpeechSec)} с
          </Row>
        )}

        {card.droppedClaims > 0 && (
          <Row label="Отброшено">
            <span className="font-medium">{card.droppedClaims}</span>
            <span className="ml-2 text-ink-soft">
              утверждений без опоры на разговор — в карточку они не попали
            </span>
          </Row>
        )}
      </div>
    </section>
  )
}
