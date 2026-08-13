import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleConfig } from '@/lib/roles'
import type { Turn } from '@/lib/types'

/**
 * Заявка «количество вопросов меняется без правки кода» должна быть доказана, а не
 * объявлена. Здесь роль подменяется на двухвопросную и на семивопросную, и проверяется,
 * что через всю цепочку — инструкции агенту, инструменты сессии, промпты, сборка
 * карточки — проходит именно то количество, что задано конфигом.
 */

function makeRole(questionCount: number, factCount: number): RoleConfig {
  return {
    id: 'synthetic',
    title: 'Synthetic Role',
    minutes: questionCount * 2,
    company: 'Company blurb.',
    role: 'Role blurb.',
    pitch: 'Pitch blurb.',
    questions: Array.from({ length: questionCount }, (_, i) => ({
      id: `q${i + 1}`,
      label: `Вопрос ${i + 1}`,
      topic: `Topic ${i + 1}`,
      ask: `Question number ${i + 1}`,
    })),
    facts: Array.from({ length: factCount }, (_, i) => ({
      id: `f${i + 1}`,
      label: `Факт ${i + 1}`,
      what: `fact number ${i + 1}`,
    })),
    faq: [{ q: 'compensation', a: 'Discussed later.' }],
  }
}

let role: RoleConfig

vi.mock('@/lib/roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/roles')>()),
  loadRole: () => role,
  roleTitle: () => role.title,
}))

const parse = vi.fn()
vi.mock('openai', () => ({
  default: class {
    responses = { parse }
  },
}))

const turns: Turn[] = [
  { id: 'a1', speaker: 'agent', text: 'Question number 1', tStart: 0, tEnd: 3, timingSource: 'server' },
  {
    id: 'c1',
    speaker: 'candidate',
    text: 'I am based in Lisbon and I have worked in admissions for three years running my own portfolio of applicants.',
    tStart: 4,
    tEnd: 40,
    timingSource: 'server',
  },
  {
    id: 'c2',
    speaker: 'candidate',
    text: 'The situation was a delayed visa, I rebuilt the timeline myself, and the student started on time.',
    tStart: 41,
    tEnd: 80,
    timingSource: 'server',
  },
  {
    id: 'c3',
    speaker: 'candidate',
    text: 'I would like full time work and I can start in two weeks after wrapping up my current contract.',
    tStart: 81,
    tEnd: 120,
    timingSource: 'server',
  },
]

const parsed = (output: unknown) => ({ output_parsed: output })

beforeEach(() => {
  parse.mockReset()
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.OPENAI_ANALYSIS_MODEL = 'gpt-5.5'
})

describe.each([
  { questions: 2, facts: 3 },
  { questions: 7, facts: 9 },
])('роль с $questions вопросами и $facts фактами', ({ questions, facts }) => {
  beforeEach(() => {
    role = makeRole(questions, facts)
  })

  it('инструкции агенту нумеруют все вопросы', async () => {
    const { buildInstructions } = await import('@/lib/roles')
    const text = buildInstructions(role)
    for (let i = 1; i <= questions; i++) expect(text).toContain(`${i}. [q${i}]`)
    expect(text).not.toContain(`${questions + 1}. [q${questions + 1}]`)
  })

  it('инструмент прогресса знает ровно эти вопросы', async () => {
    const { buildSessionConfig } = await import('@/lib/realtime-session')
    const config = buildSessionConfig('synthetic', 'Pavel')
    const tool = config.tools.find((t) => t.name === 'question_started')!
    expect(tool.parameters.properties.questionId!.enum).toEqual(
      Array.from({ length: questions }, (_, i) => `q${i + 1}`),
    )
  })

  it('заявленная агентом длительность берётся из конфига', async () => {
    const { buildInstructions } = await import('@/lib/roles')
    expect(buildInstructions(role)).toContain(`about ${questions * 2} minutes`)
    expect(buildInstructions(role)).not.toContain('about ten minutes')
  })

  it('промпт фактов просит ровно этот набор', async () => {
    const { factsPrompt } = await import('@/lib/analyze/prompts')
    const text = factsPrompt(role, 'transcript')
    for (let i = 1; i <= facts; i++) expect(text).toContain(`id "f${i}"`)
    expect(text).not.toContain(`id "f${facts + 1}"`)
  })

  it('карточка получает столько фактов, сколько объявлено, и в том же порядке', async () => {
    parse
      .mockResolvedValueOnce(
        parsed({
          summary: 'ok',
          coverage: Array.from({ length: questions }, (_, i) => ({
            questionId: `q${i + 1}`,
            answered: 'yes',
            note: 'n',
            evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }],
          })),
          example: {
            situation: { present: true, note: 'n', evidence: [{ turnId: 'c2', quote: 'a delayed visa' }] },
            action: { present: true, note: 'n', evidence: [{ turnId: 'c2', quote: 'I rebuilt the timeline' }] },
            result: { present: true, note: 'n', evidence: [{ turnId: 'c2', quote: 'started on time' }] },
          },
        }),
      )
      .mockResolvedValueOnce(parsed({ summary: 'ok', rangeLow: 'B2', rangeHigh: 'C1', subscores: [] }))
      .mockResolvedValueOnce(parsed({ summary: 'ok', signals: [] }))
      .mockResolvedValueOnce(
        parsed({
          facts: Array.from({ length: facts }, (_, i) => ({
            id: `f${i + 1}`,
            value: `value ${i + 1}`,
            evidence: [{ turnId: 'c3', quote: 'full time work' }],
          })),
        }),
      )
      .mockResolvedValueOnce(parsed({ summary: 'ok', asked: [] }))

    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns, roleId: 'synthetic' })

    expect(card.facts).toHaveLength(facts)
    expect(card.facts.map((f) => f.id)).toEqual(role.facts.map((f) => f.id))
    expect(card.facts.map((f) => f.label)).toEqual(role.facts.map((f) => f.label))
    expect(card.structure.coverage).toHaveLength(questions)
  })
})
