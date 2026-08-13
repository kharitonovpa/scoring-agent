/**
 * Разовая миграция сохранённых карточек.
 *
 * Карточка лежит в базе как JSON, и за день её форма менялась трижды: факты стали списком,
 * появился блок вопросов кандидата, разбор одного примера стал списком разборов. Записи,
 * сделанные прежними версиями, открываться перестали — страница падала на `.map` по полю,
 * которого в них нет.
 *
 * Здесь данные приводятся к текущей форме один раз, вместо постоянного слоя совместимости
 * в коде: сессий немного и все они тестовые. Ничего не выдумывается — старый разбор
 * переносится как есть, отсутствующее заполняется честной пометкой «этого блока тогда
 * не было».
 *
 * Запуск: npm run migrate:cards  (сначала печатает план, применяет с --apply)
 */
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)
const apply = process.argv.includes('--apply')

/** Подписи фактов из прежней роли: в текущем конфиге этих идентификаторов уже нет. */
const LEGACY_FACT_LABELS: Record<string, string> = {
  location: 'Локация',
  workRight: 'Право на работу',
  domainExperience: 'Опыт в домене',
  workFormat: 'Формат работы',
  startDate: 'Срок выхода',
}

type Json = Record<string, unknown>

function migrate(card: Json): { card: Json; changes: string[] } {
  const changes: string[] = []
  const next: Json = { ...card }

  // 1. Факты: объект с зашитыми полями → список.
  if (next.facts && !Array.isArray(next.facts)) {
    const entries = Object.entries(next.facts as Record<string, Json>)
    next.facts = entries.map(([id, fact]) => ({
      id,
      label: LEGACY_FACT_LABELS[id] ?? id,
      value: fact?.value ?? null,
      evidence: Array.isArray(fact?.evidence) ? fact.evidence : [],
    }))
    changes.push(`факты: объект → список (${entries.length})`)
  }

  // 2. Разбор примера: одно поле → список разборов, данные переносятся.
  const structure = { ...((next.structure ?? {}) as Json) }
  if (!Array.isArray(structure.examples)) {
    const legacy = structure.example as Json | undefined
    structure.examples = legacy
      ? [
          {
            questionId: 'legacy',
            questionLabel: 'Пример из практики',
            situation: legacy.situation,
            action: legacy.action,
            result: legacy.result,
          },
        ]
      : []
    changes.push(legacy ? 'пример → список разборов' : 'список разборов: пустой')
  }
  if ('example' in structure) {
    delete structure.example
    changes.push('удалено устаревшее поле example')
  }
  next.structure = structure

  // 3. Блок вопросов кандидата: тогда его не считали, выдумывать нечего.
  if (!next.curiosity) {
    next.curiosity = {
      summary: 'Этот разговор прошёл до того, как карточка начала отмечать вопросы кандидата.',
      asked: [],
    }
    changes.push('добавлен блок вопросов кандидата (пустой)')
  }

  return { card: next, changes }
}

const rows = (await sql`
  SELECT id, candidate_name, card FROM sessions WHERE card IS NOT NULL ORDER BY started_at
`) as { id: string; candidate_name: string; card: Json }[]

let touched = 0
for (const row of rows) {
  const { card, changes } = migrate(row.card)
  if (changes.length === 0) {
    console.log(`· ${row.candidate_name}: уже в текущей форме`)
    continue
  }
  touched++
  console.log(`${apply ? '✓' : '→'} ${row.candidate_name}`)
  for (const c of changes) console.log(`    ${c}`)
  if (apply) {
    await sql`UPDATE sessions SET card = ${JSON.stringify(card)}::jsonb WHERE id = ${row.id}`
  }
}

console.log(
  apply
    ? `\nОбновлено карточек: ${touched} из ${rows.length}.`
    : `\nБудет обновлено: ${touched} из ${rows.length}. Применить: npm run migrate:cards -- --apply`,
)
