import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oneWordCandidate, strongCandidate } from './fixtures/transcripts'

const parse = vi.fn()
vi.mock('openai', () => ({
  default: class {
    responses = { parse }
  },
}))
vi.mock('openai/helpers/zod', () => ({
  zodTextFormat: (_s: unknown, name: string) => ({ type: 'json_schema', name }),
}))

const parsed = (output_parsed: unknown) => ({ output_parsed })

const structure = {
  summary: 'Answers what is asked.',
  coverage: [
    {
      questionId: 'solo_delivery',
      answered: 'yes',
      note: 'Named the city.',
      evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }],
    },
  ],
  example: {
    situation: {
      present: true,
      note: 'Rejected twice, tight deadline.',
      evidence: [{ turnId: 'c2', quote: 'had been rejected twice' }],
    },
    action: {
      present: true,
      note: 'Rebuilt the list herself.',
      evidence: [{ turnId: 'c2', quote: 'I rebuilt her list' }],
    },
    result: {
      present: true,
      note: 'Admitted in August.',
      evidence: [{ turnId: 'c2', quote: 'She was admitted in August' }],
    },
  },
}

const language = {
  summary: 'Comfortable, complex sentences.',
  rangeLow: 'B2',
  rangeHigh: 'C1',
  subscores: [
    {
      name: 'grammar',
      band: 'C1',
      note: 'Past perfect used correctly.',
      evidence: [{ turnId: 'c2', quote: 'had been rejected twice' }],
    },
    {
      name: 'vocabulary',
      band: 'B2',
      note: 'Domain words are precise.',
      evidence: [{ turnId: 'c2', quote: 'rewrote her personal statement' }],
    },
    {
      name: 'coherence',
      band: 'C1',
      note: 'Narrates in order.',
      evidence: [{ turnId: 'c2', quote: 'came to me in June' }],
    },
  ],
}

const delivery = { summary: 'Nothing worth flagging.', signals: [] }

const curiosity = { summary: 'ok', asked: [] }

const facts = {
  facts: [
    { id: 'location', value: 'Lisbon', evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }] },
    {
      id: 'workRight',
      value: 'Contractor for three years',
      evidence: [{ turnId: 'c1', quote: 'invoicing as a contractor' }],
    },
    {
      id: 'domainExperience',
      value: 'Two years at an education agency',
      evidence: [{ turnId: 'c2', quote: 'two years at an education agency' }],
    },
    { id: 'workFormat', value: 'Full time', evidence: [{ turnId: 'c3', quote: 'full time' }] },
    { id: 'startDate', value: null, evidence: [] },
  ],
}

/** Порядок вызовов в buildCard: структура, язык, манера, факты. */
function mockAll(
  overrides: Partial<
    Record<'structure' | 'language' | 'delivery' | 'facts' | 'curiosity', unknown>
  > = {},
) {
  parse.mockReset()
  parse
    .mockResolvedValueOnce(parsed(overrides.structure ?? structure))
    .mockResolvedValueOnce(parsed(overrides.language ?? language))
    .mockResolvedValueOnce(parsed(overrides.delivery ?? delivery))
    .mockResolvedValueOnce(parsed(overrides.facts ?? facts))
    .mockResolvedValueOnce(parsed(overrides.curiosity ?? curiosity))
}

beforeEach(() => {
  process.env.OPENAI_ANALYSIS_MODEL = 'test-model'
  mockAll()
})

describe('buildCard', () => {
  it('собирает карточку и считает метрики', async () => {
    const { buildCard } = await import('@/lib/analyze')
    const { card, metrics } = await buildCard({
      turns: strongCandidate,
      roleId: 'unimatch-default',
    })

    expect(card.language).toMatchObject({ rangeLow: 'B2', rangeHigh: 'C1' })
    expect(card.structure.coverage).toHaveLength(1)
    expect(card.structure.coverage[0].questionLabel).toBe('Solo-ведение фичи или MVP до прода')
    expect(card.facts.find((f) => f.id === 'location')!.value).toBe('Lisbon')
    expect(metrics.candidateTurnCount).toBe(4)
    expect(parse).toHaveBeenCalledTimes(5)
  })

  it('выбрасывает выдуманные цитаты и считает выброшенное', async () => {
    mockAll({
      structure: {
        ...structure,
        coverage: [
          {
            questionId: 'solo_delivery',
            answered: 'yes',
            note: 'x',
            evidence: [{ turnId: 'c1', quote: 'I have a PhD from Oxford' }],
          },
        ],
      },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })
    expect(card.structure.coverage).toHaveLength(0)
    expect(card.droppedClaims).toBeGreaterThan(0)
  })

  it('состав и порядок фактов задаёт конфиг роли, а не модель', async () => {
    mockAll({
      facts: {
        facts: [
          // Модель вернула лишний идентификатор и перепутала порядок.
          { id: 'выдуманный', value: 'x', evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }] },
          ...[...facts.facts].reverse(),
        ],
      },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })

    const { loadRole } = await import('@/lib/roles')
    expect(card.facts.map((f) => f.id)).toEqual(loadRole('unimatch-default').facts.map((f) => f.id))
    expect(card.facts.map((f) => f.label)).toEqual(
      loadRole('unimatch-default').facts.map((f) => f.label),
    )
  })

  it('обнуляет факт, чья цитата не подтвердилась', async () => {
    mockAll({
      facts: {
        facts: [
          ...facts.facts.filter((f) => f.id !== 'startDate'),
          {
            id: 'startDate',
            value: 'Tomorrow',
            evidence: [{ turnId: 'c4', quote: 'I can start tomorrow' }],
          },
        ],
      },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })
    expect(card.facts.find((f) => f.id === 'startDate')).toEqual({
      id: 'startDate',
      label: 'Срок выхода',
      value: null,
      evidence: [],
    })
  })

  it('не оценивает язык и манеру при односложных ответах и не тратит на это вызовы', async () => {
    parse.mockReset()
    parse
      .mockResolvedValueOnce(parsed({ ...structure, coverage: [] }))
      .mockResolvedValueOnce(
        parsed({
          facts: facts.facts.map((f) =>
            f.id === 'location' || f.id === 'workRight' ? f : { ...f, value: null, evidence: [] },
          ),
        }),
      )
      .mockResolvedValueOnce(parsed(curiosity))

    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: oneWordCandidate, roleId: 'unimatch-default' })

    expect(card.language).toMatchObject({ insufficient: true })
    expect(card.delivery).toMatchObject({ insufficient: true })
    expect((card.language as { reason: string }).reason).toMatch(/60/)
    // Структура, факты и вопросы кандидата — три вызова. Язык и манеру пропускаем: по
    // односложным ответам их оценивать нечестно. А вопрос кандидата остаётся вопросом
    // независимо от того, сколько он наговорил, поэтому этот блок считается всегда.
    expect(parse).toHaveBeenCalledTimes(3)
  })

  it('отказывается анализировать разговор без реплик кандидата', async () => {
    const { buildCard } = await import('@/lib/analyze')
    await expect(
      buildCard({
        turns: [
          { id: 'a1', speaker: 'agent', text: 'hi', tStart: 0, tEnd: 1, timingSource: 'client' },
        ],
        roleId: 'unimatch-default',
      }),
    ).rejects.toThrow(/candidate/i)
  })
})
