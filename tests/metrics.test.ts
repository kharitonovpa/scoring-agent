import { describe, expect, it } from 'vitest'
import { computeMetrics, hasEnoughSpeech } from '@/lib/metrics'
import type { Turn } from '@/lib/types'

const t = (id: string, speaker: Turn['speaker'], tStart: number, tEnd: number): Turn => ({
  id,
  speaker,
  text: 'x',
  tStart,
  tEnd,
  timingSource: 'server',
})

describe('computeMetrics', () => {
  it('считает длительность, доли речи и паузы перед ответами', () => {
    const m = computeMetrics([
      t('a1', 'agent', 0, 4),
      t('c1', 'candidate', 6, 16),
      t('a2', 'agent', 17, 19),
      t('c2', 'candidate', 24, 34),
    ])
    expect(m.durationSec).toBe(34)
    expect(m.candidateSpeechSec).toBe(20)
    expect(m.agentSpeechSec).toBe(6)
    expect(m.candidateSharePct).toBe(77)
    expect(m.candidateTurnCount).toBe(2)
    expect(m.pauses).toEqual([
      { turnId: 'c1', pauseSec: 2 },
      { turnId: 'c2', pauseSec: 5 },
    ])
    expect(m.medianPauseSec).toBe(3.5)
    expect(m.longestPauseSec).toBe(5)
  })

  it('не считает паузу между двумя репликами кандидата', () => {
    const m = computeMetrics([t('c1', 'candidate', 0, 2), t('c2', 'candidate', 9, 10)])
    expect(m.pauses).toEqual([])
  })

  it('не даёт отрицательных пауз при перебивании', () => {
    const m = computeMetrics([t('a1', 'agent', 0, 5), t('c1', 'candidate', 4, 8)])
    expect(m.pauses).toEqual([{ turnId: 'c1', pauseSec: 0 }])
  })

  it('переживает пустой транскрипт', () => {
    const m = computeMetrics([])
    expect(m).toMatchObject({
      durationSec: 0,
      candidateSharePct: 0,
      medianPauseSec: 0,
      longestPauseSec: 0,
    })
  })
})

describe('hasEnoughSpeech', () => {
  it('хватает при трёх репликах и минуте речи', () => {
    const m = computeMetrics([
      t('c1', 'candidate', 0, 25),
      t('c2', 'candidate', 30, 55),
      t('c3', 'candidate', 60, 75),
    ])
    expect(hasEnoughSpeech(m)).toBe(true)
  })

  it('не хватает при односложных ответах', () => {
    const m = computeMetrics([
      t('c1', 'candidate', 0, 2),
      t('c2', 'candidate', 5, 7),
      t('c3', 'candidate', 9, 11),
    ])
    expect(hasEnoughSpeech(m)).toBe(false)
  })

  it('не хватает при одной длинной реплике: одного ответа мало для оценки', () => {
    const m = computeMetrics([t('c1', 'candidate', 0, 200)])
    expect(hasEnoughSpeech(m)).toBe(false)
  })

  it('не хватает при пустом разговоре', () => {
    expect(hasEnoughSpeech(computeMetrics([]))).toBe(false)
  })
})
