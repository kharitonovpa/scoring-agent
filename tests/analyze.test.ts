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
      questionId: 'location',
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

const facts = {
  location: { value: 'Lisbon', evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }] },
  workRight: {
    value: 'Contractor for three years',
    evidence: [{ turnId: 'c1', quote: 'invoicing as a contractor' }],
  },
  domainExperience: {
    value: 'Two years at an education agency',
    evidence: [{ turnId: 'c2', quote: 'two years at an education agency' }],
  },
  workFormat: {
    value: 'Full time, remote',
    evidence: [{ turnId: 'c3', quote: 'Full time and fully remote' }],
  },
  startDate: {
    value: 'In three weeks',
    evidence: [{ turnId: 'c4', quote: 'Three weeks from now' }],
  },
}

/** Порядок вызовов в buildCard: структура, язык, манера, факты. */
function mockAll(
  overrides: Partial<Record<'structure' | 'language' | 'delivery' | 'facts', unknown>> = {},
) {
  parse.mockReset()
  parse
    .mockResolvedValueOnce(parsed(overrides.structure ?? structure))
    .mockResolvedValueOnce(parsed(overrides.language ?? language))
    .mockResolvedValueOnce(parsed(overrides.delivery ?? delivery))
    .mockResolvedValueOnce(parsed(overrides.facts ?? facts))
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
    expect(card.structure.coverage[0].questionLabel).toBe('Локация и право на работу')
    expect(card.facts.location.value).toBe('Lisbon')
    expect(metrics.candidateTurnCount).toBe(4)
    expect(parse).toHaveBeenCalledTimes(4)
  })

  it('выбрасывает выдуманные цитаты и считает выброшенное', async () => {
    mockAll({
      structure: {
        ...structure,
        coverage: [
          {
            questionId: 'location',
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

  it('обнуляет факт, чья цитата не подтвердилась', async () => {
    mockAll({
      facts: {
        ...facts,
        startDate: { value: 'Tomorrow', evidence: [{ turnId: 'c4', quote: 'I can start tomorrow' }] },
      },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })
    expect(card.facts.startDate).toEqual({ value: null, evidence: [] })
  })

  it('не оценивает язык и манеру при односложных ответах и не тратит на это вызовы', async () => {
    parse.mockReset()
    parse
      .mockResolvedValueOnce(parsed({ ...structure, coverage: [] }))
      .mockResolvedValueOnce(
        parsed({
          location: facts.location,
          workRight: facts.workRight,
          domainExperience: { value: null, evidence: [] },
          workFormat: { value: null, evidence: [] },
          startDate: { value: null, evidence: [] },
        }),
      )

    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: oneWordCandidate, roleId: 'unimatch-default' })

    expect(card.language).toMatchObject({ insufficient: true })
    expect(card.delivery).toMatchObject({ insufficient: true })
    expect((card.language as { reason: string }).reason).toMatch(/60/)
    expect(parse).toHaveBeenCalledTimes(2)
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
