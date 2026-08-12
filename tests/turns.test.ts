import { describe, expect, it } from 'vitest'
import { assembleTurns, computeAudioOffset, type StampedEvent } from '@/lib/turns'

const ev = (clientTimeSec: number, event: Record<string, unknown>): StampedEvent => ({
  clientTimeSec,
  event,
})

describe('assembleTurns', () => {
  it('склеивает тайминги кандидата с транскрипцией по item_id', () => {
    const turns = assembleTurns([
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'msg_7' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'msg_7' }),
      ev(16.4, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'msg_7',
        transcript: 'I led a team of six',
      }),
    ])
    expect(turns).toEqual([
      {
        id: 'msg_7',
        speaker: 'candidate',
        text: 'I led a team of six',
        tStart: 12.4,
        tEnd: 15.9,
        timingSource: 'server',
      },
    ])
  })

  it('переживает транскрипцию, пришедшую раньше VAD-событий', () => {
    const turns = assembleTurns([
      ev(16.4, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'm1',
        transcript: 'hello',
      }),
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'm1' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'm1' }),
    ])
    expect(turns[0].tStart).toBe(12.4)
    expect(turns[0].timingSource).toBe('server')
  })

  it('ставит реплики агента на ту же шкалу через калибровку', () => {
    // speech_started: серверные 12.4с при клиентских 12.5с → сдвиг -0.1с
    const turns = assembleTurns([
      ev(4.0, {
        type: 'response.output_audio_transcript.done',
        item_id: 'a1',
        transcript: 'Where are you based?',
      }),
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'msg_7' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'msg_7' }),
      ev(16.4, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'msg_7',
        transcript: 'Berlin',
      }),
    ])
    const agent = turns.find((t) => t.speaker === 'agent')!
    expect(agent.tEnd).toBeCloseTo(3.9, 3)
    expect(agent.timingSource).toBe('client')
    expect(turns.map((t) => t.speaker)).toEqual(['agent', 'candidate'])
  })

  it('без серверных таймингов не падает, а помечает источник как клиентский', () => {
    const turns = assembleTurns([
      ev(5.0, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'm1',
        transcript: 'hi',
      }),
    ])
    expect(turns[0].timingSource).toBe('client')
    expect(turns[0].tEnd).toBe(5.0)
  })

  it('выбрасывает пустые транскрипции и не дублирует item_id', () => {
    const turns = assembleTurns([
      ev(1.0, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'm1',
        transcript: '   ',
      }),
      ev(2.0, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'm2',
        transcript: 'ok',
      }),
      ev(2.5, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'm2',
        transcript: 'ok',
      }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].id).toBe('m2')
  })

  it('игнорирует незнакомые события', () => {
    expect(assembleTurns([ev(1, { type: 'session.updated' })])).toEqual([])
  })
})

describe('computeAudioOffset', () => {
  const speech = ev(12.5, {
    type: 'input_audio_buffer.speech_started',
    audio_start_ms: 12400,
    item_id: 'm1',
  })

  it('говорит, в какой секунде серверной шкалы начинается запись', () => {
    // Серверный нуль пришёлся на клиентские 0.1с; запись стартовала в клиентские 1.1с
    // → нулевая секунда файла соответствует серверной 1.0с.
    expect(computeAudioOffset([speech], 1.1)).toBeCloseTo(1.0, 3)
  })

  it('даёт ноль, когда запись стартовала вместе с серверной шкалой', () => {
    expect(computeAudioOffset([speech], 0.1)).toBeCloseTo(0, 3)
  })

  it('допускает отрицательный сдвиг, если запись началась раньше серверной шкалы', () => {
    expect(computeAudioOffset([speech], 0)).toBeCloseTo(-0.1, 3)
  })

  it('возвращает null, когда серверных таймингов не было', () => {
    expect(computeAudioOffset([ev(1, { type: 'session.updated' })], 0.5)).toBeNull()
  })
})
