import { describe, expect, it } from 'vitest'
import { keepSupported, normalize, validateEvidence } from '@/lib/evidence'
import type { Turn } from '@/lib/types'

const turns: Turn[] = [
  {
    id: 'c1',
    speaker: 'candidate',
    text: 'I led a team of six, and we shipped it in April.',
    tStart: 1,
    tEnd: 5,
    timingSource: 'server',
  },
  {
    id: 'a1',
    speaker: 'agent',
    text: 'Where are you based?',
    tStart: 0,
    tEnd: 1,
    timingSource: 'client',
  },
]

describe('normalize', () => {
  it('снимает регистр, пунктуацию и лишние пробелы', () => {
    expect(normalize('  I led a TEAM, of six! ')).toBe('i led a team of six')
  })
})

describe('validateEvidence', () => {
  it('оставляет цитату, входящую в реплику кандидата', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'led a team of six' }], turns)).toHaveLength(1)
  })

  it('пропускает цитату с другой пунктуацией и регистром', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'Led a team of six!' }], turns)).toHaveLength(1)
  })

  it('выбрасывает выдуманную цитату', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'I managed twenty people' }], turns)).toEqual([])
  })

  it('выбрасывает ссылку на несуществующую реплику', () => {
    expect(validateEvidence([{ turnId: 'nope', quote: 'led a team' }], turns)).toEqual([])
  })

  it('выбрасывает ссылку на реплику агента: оцениваем кандидата, не агента', () => {
    expect(validateEvidence([{ turnId: 'a1', quote: 'Where are you based' }], turns)).toEqual([])
  })

  it('выбрасывает пустую цитату', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: '   ' }], turns)).toEqual([])
  })
})

describe('keepSupported', () => {
  it('оставляет только утверждения с подтверждённой опорой и считает выброшенные', () => {
    const result = keepSupported(
      [
        { label: 'ok', evidence: [{ turnId: 'c1', quote: 'shipped it in April' }] },
        { label: 'fabricated', evidence: [{ turnId: 'c1', quote: 'I have a PhD' }] },
        { label: 'bare', evidence: [] },
      ],
      turns,
    )
    expect(result.kept.map((k) => k.label)).toEqual(['ok'])
    expect(result.dropped).toBe(2)
  })

  it('чистит частично выдуманный набор цитат, сохраняя утверждение', () => {
    const result = keepSupported(
      [
        {
          label: 'mixed',
          evidence: [
            { turnId: 'c1', quote: 'led a team of six' },
            { turnId: 'c1', quote: 'I have a PhD' },
          ],
        },
      ],
      turns,
    )
    expect(result.kept[0].evidence).toHaveLength(1)
    expect(result.dropped).toBe(0)
  })
})
