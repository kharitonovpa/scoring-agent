import { isInsufficient, type Card, type Evidence, type Turn } from '@/lib/types'
import { EvidenceQuote } from './EvidenceQuote'

type Ctx = { turns: Turn[]; audioOffsetSec: number | null }

function Quotes({ evidence, ctx }: { evidence: Evidence[]; ctx: Ctx }) {
  return (
    <div className="mt-2.5 space-y-1.5">
      {evidence.map((e, i) => (
        <EvidenceQuote key={i} evidence={e} turns={ctx.turns} audioOffsetSec={ctx.audioOffsetSec} />
      ))}
    </div>
  )
}

function Block({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="surface p-6 sm:p-7">
      <h2 className="text-[1.0625rem] font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{subtitle}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  )
}

const ANSWERED: Record<string, string> = {
  yes: 'Ответил на вопрос',
  partial: 'Ответил частично',
  off_topic: 'Ушёл в сторону',
}

export function FactsBlock({ card, ctx }: { card: Card; ctx: Ctx }) {
  return (
    <Block title="Собранные факты">
      {card.facts.map((fact) => (
        <div key={fact.id}>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span className="w-40 shrink-0 text-ink-soft">{fact.label}</span>
            <span className={fact.value ? 'font-medium' : 'text-ink-faint'}>
              {fact.value ?? 'не прозвучало в разговоре'}
            </span>
          </div>
          <Quotes evidence={fact.evidence} ctx={ctx} />
        </div>
      ))}
    </Block>
  )
}

export function CuriosityBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  return (
    <Block title="О чём спросил сам" subtitle={card.curiosity.summary}>
      {card.curiosity.asked.length === 0 && (
        <div className="flex gap-3 rounded-xl bg-paper p-5 text-sm leading-relaxed text-ink-soft">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs text-accent">
            —
          </span>
          <span>
            Кандидат не задал ни одного вопроса о компании, роли или процессе. Это нормальный исход
            и сам по себе ни о чём не говорит — трактовать его вам.
          </span>
        </div>
      )}
      {card.curiosity.asked.map((a, i) => (
        <div key={i}>
          <div className="text-sm">
            <span className="font-medium">{a.topic}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{a.note}</p>
          <Quotes evidence={a.evidence} ctx={ctx} />
        </div>
      ))}
    </Block>
  )
}

const STAR: [string, 'situation' | 'action' | 'result'][] = [
  ['Ситуация', 'situation'],
  ['Что сделал сам', 'action'],
  ['Результат', 'result'],
]

export function StructureBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  return (
    <Block title="Насколько структурно говорит" subtitle={card.structure.summary}>
      <div className="space-y-4">
        {card.structure.coverage.map((c) => (
          <div key={c.questionId}>
            <div className="text-sm">
              <span className="font-medium">{c.questionLabel}</span>
              <span className="chip ml-2">{ANSWERED[c.answered] ?? c.answered}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{c.note}</p>
            <Quotes evidence={c.evidence} ctx={ctx} />
          </div>
        ))}
      </div>

      {/* Примеров столько, сколько вопросов их требуют. Раньше здесь был один блок, и
          второй случай — тот, что показывает продуктовое мышление, — терялся. */}
      {card.structure.examples.map((example) => (
        <div key={example.questionId} className="rounded-xl bg-paper p-5">
          <h3 className="text-sm font-semibold">
            {example.questionLabel}: ситуация → действие → результат
          </h3>
          {STAR.map(([label, key]) => {
            const element = example[key]
            return (
              <div key={key} className="mt-3">
                <div className="text-sm">
                  <span className={element.present ? 'text-accent' : 'text-ink-faint'}>
                    {element.present ? '✓' : '—'}
                  </span>{' '}
                  <span className="font-medium">{label}</span>
                  <span className="ml-2 text-ink-soft">{element.note}</span>
                </div>
                <Quotes evidence={element.evidence} ctx={ctx} />
              </div>
            )
          })}
        </div>
      ))}
    </Block>
  )
}

const SUBSCORE: Record<string, string> = {
  grammar: 'Грамматика',
  vocabulary: 'Словарь',
  coherence: 'Связность',
}

function InsufficientBlock({ title, reason }: { title: string; reason: string }) {
  return (
    <Block title={title} subtitle="Недостаточно данных для обоснованной оценки">
      <p className="text-sm leading-relaxed text-ink-soft">{reason}</p>
      <p className="text-xs leading-relaxed text-ink-faint">
        Оценку по такому объёму речи мы не выдаём: она была бы ничем не подкреплена, а это именно
        то, от чего уходит этот инструмент.
      </p>
    </Block>
  )
}

export function LanguageBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  if (isInsufficient(card.language)) {
    return <InsufficientBlock title="Уровень английского" reason={card.language.reason} />
  }
  const language = card.language
  return (
    <Block
      title={`Уровень английского: ${language.rangeLow}–${language.rangeHigh}`}
      subtitle={language.summary}
    >
      {language.subscores.map((s) => (
        <div key={s.name}>
          <div className="text-sm">
            <span className="font-medium">{SUBSCORE[s.name] ?? s.name}</span>
            <span className="chip ml-2">{s.band}</span>
            <span className="ml-2 text-ink-soft">{s.note}</span>
          </div>
          <Quotes evidence={s.evidence} ctx={ctx} />
        </div>
      ))}
      <p className="text-xs leading-relaxed text-ink-faint">
        Диапазон, а не одна буква: короткий разговор не даёт точности до подуровня.
      </p>
    </Block>
  )
}

const CONFIDENCE: Record<string, string> = {
  low: 'слабый сигнал',
  medium: 'средний сигнал',
  high: 'сильный сигнал',
}

export function DeliveryBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  if (isInsufficient(card.delivery)) {
    return <InsufficientBlock title="Как говорит" reason={card.delivery.reason} />
  }
  const delivery = card.delivery
  return (
    <Block title="Как говорит" subtitle={delivery.summary}>
      {/* Пустой список — нормальный исход, но выглядеть он должен как результат проверки,
          а не как незаполненный блок. Поэтому вместо повтора summary говорим то, чего в
          summary нет: что именно искали. */}
      {delivery.signals.length === 0 && (
        <div className="flex gap-3 rounded-xl bg-paper p-5 text-sm leading-relaxed text-ink-soft">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs text-accent">
            ✓
          </span>
          <span>
            Искали признаки заранее написанного текста: письменный синтаксис там, где остальной
            разговор звучит спонтанно, резкий сдвиг в беглости между ответами, шаблонные
            формулировки на месте конкретики. Ни один не проявился — здесь смотреть нечего.
          </span>
        </div>
      )}
      {delivery.signals.map((s, i) => (
        <div key={i}>
          <div className="text-sm">
            <span className="font-medium">{s.label}</span>
            <span className="chip ml-2">
              {CONFIDENCE[s.confidence] ?? s.confidence}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">На что посмотреть: {s.whatToCheck}</p>
          <Quotes evidence={s.evidence} ctx={ctx} />
        </div>
      ))}
    </Block>
  )
}

/**
 * Содержание здесь обязательное, а не декоративное: запрет на оценку по акценту, темпу,
 * полу и возрасту — прямое требование, а «решение принимает рекрутер» снимает главный
 * юридический риск автоматизированного решения о человеке в найме.
 *
 * Но читают это один раз, поэтому блок в полный размер отнимал внимание у данных о
 * кандидате. Видимой остаётся одна строка — та, без которой нельзя; остальное по клику.
 */
export function Disclaimer({ dropped }: { dropped: number }) {
  return (
    <details className="rounded-card border border-dashed border-line-strong px-6 py-4 text-sm leading-relaxed text-ink-soft sm:px-7">
      <summary className="cursor-pointer marker:text-ink-faint">
        <span className="font-medium text-ink">Решение принимает рекрутер, не ассистент.</span>{' '}
        Что карточка намеренно не оценивает
      </summary>
      <ul className="mt-3 list-inside list-disc space-y-1">
        <li>Не оценивает акцент, темп речи, пол и возраст — это дискриминация и юридический риск.</li>
        <li>Не считает паузу негативным сигналом сама по себе.</li>
        <li>Не описывает эмоции кандидата: вывод эмоций в найме запрещён регулированием.</li>
      </ul>
      {dropped > 0 && (
        <p className="mt-3">
          Утверждений без опоры на разговор отброшено: {dropped}. Они не попали в карточку.
        </p>
      )}
    </details>
  )
}
