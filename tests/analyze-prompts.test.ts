import type { Turn } from '@/lib/types'
import { describe, expect, it } from 'vitest'
import { deliveryPrompt, factsPrompt, languagePrompt, renderTranscript, structurePrompt } from '@/lib/analyze/prompts'
import { loadRole } from '@/lib/roles'
import type { Metrics, Turn } from '@/lib/types'

const turns: Turn[] = [
  { id: 'a1', speaker: 'agent', text: 'Where are you based?', tStart: 0, tEnd: 2, timingSource: 'client' },
  {
    id: 'c1',
    speaker: 'candidate',
    text: 'Berlin, and I can work as a contractor.',
    tStart: 3,
    tEnd: 7,
    timingSource: 'server',
  },
]

const metrics: Metrics = {
  durationSec: 7,
  candidateSpeechSec: 4,
  agentSpeechSec: 2,
  candidateSharePct: 67,
  candidateTurnCount: 1,
  pauses: [{ turnId: 'c1', pauseSec: 1 }],
  medianPauseSec: 1,
  longestPauseSec: 1,
}

describe('renderTranscript', () => {
  it('помечает реплики id и говорящим', () => {
    const text = renderTranscript(turns)
    expect(text).toContain('[c1] CANDIDATE')
    expect(text).toContain('[a1] RECRUITER')
    expect(text).toContain('Berlin')
  })
})

describe('промпты', () => {
  it('структурный промпт перечисляет вопросы роли по id', () => {
    const prompt = structurePrompt(loadRole('unimatch-default'), renderTranscript(turns))
    expect(prompt).toContain('location')
    expect(prompt).toContain('experience')
  })

  it('каждый промпт требует цитаты и запрещает дискриминационные признаки', () => {
    for (const prompt of [
      structurePrompt(loadRole('unimatch-default'), 'x'),
      languagePrompt('x', 10),
      deliveryPrompt('x', metrics),
    ]) {
      expect(prompt).toMatch(/evidence/i)
      expect(prompt).toMatch(/accent/i)
      expect(prompt).toMatch(/age/i)
      expect(prompt).toMatch(/gender/i)
    }
  })

  it('каждый промпт запрещает выводы об эмоциональном состоянии', () => {
    for (const prompt of [
      structurePrompt(loadRole('unimatch-default'), 'x'),
      languagePrompt('x', 10),
      deliveryPrompt('x', metrics),
      factsPrompt(loadRole('unimatch-default'), 'x'),
    ]) {
      expect(prompt).toMatch(/emotional state/i)
      expect(prompt).toMatch(/nervousness|confidence/i)
    }
  })

  it('промпт манеры речи прямо запрещает трактовать паузу как негатив', () => {
    const prompt = deliveryPrompt('x', metrics)
    expect(prompt).toMatch(/pause/i)
    expect(prompt).toMatch(/never treat a pause/i)
  })
})

describe('обрывки помечены в транскрипте', () => {
  const turn = (id: string, tStart: number, tEnd: number, text: string, speaker = 'candidate') =>
    ({ id, speaker, text, tStart, tEnd, timingSource: 'server' }) as Turn

  it('короткая реплика кандидата помечена как шум', () => {
    const text = renderTranscript([turn('c1', 10, 10.2, 'Uh')])
    expect(text).toMatch(/MICROPHONE NOISE/)
  })

  it('полноценная реплика не помечена', () => {
    const text = renderTranscript([turn('c2', 10, 25, 'I worked at an education agency')])
    expect(text).not.toMatch(/MICROPHONE NOISE/)
  })

  it('реплики агента не помечаются никогда', () => {
    const text = renderTranscript([turn('a1', 10, 10.1, 'Ok', 'agent')])
    expect(text).not.toMatch(/MICROPHONE NOISE/)
  })
})
