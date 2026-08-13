import { describe, expect, it } from 'vitest'
import { askForResponse, INITIAL_FLOOR, isQuiet, nextFloor, type FloorState } from '@/lib/floor'

/** Прогоняет последовательность событий и возвращает состояние с эффектами последнего шага. */
function play(events: Record<string, unknown>[], from: FloorState = INITIAL_FLOOR) {
  let state = from
  let effects: string[] = []
  for (const event of events) {
    const step = nextFloor(state, event)
    state = step.state
    effects = step.effects
  }
  return { state, effects }
}

const agentStarts = { type: 'response.created' }
const agentFinishes = { type: 'response.done' }
const speechStarts = { type: 'input_audio_buffer.speech_started' }
const speechStops = { type: 'input_audio_buffer.speech_stopped' }
const transcribed = (transcript: string) => ({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript,
})

describe('nextFloor', () => {
  it('ничего не просит у агента, пока агент говорит', () => {
    // Скрип двери посреди длинной реплики: VAD видит звук и его конец. Ни одного
    // эффекта, который мог бы обернуться response.create — иначе реплика обрывается.
    const { effects } = play([agentStarts, speechStarts, speechStops])

    expect(effects).not.toContain('request-response')
    expect(effects).not.toContain('arm-silence')
  })

  it('после реплики агента заводит страховку, если кандидат говорил поверх неё', () => {
    // Ради этого случая страховка и существует: при interrupt_response: false сервер
    // может не создать ответ на речь, прозвучавшую во время реплики агента. Но просить
    // сразу нельзя: сервер мог и создать — тогда его response.created снимет страховку,
    // и второго ответа не будет.
    const { state, effects } = play([agentStarts, speechStarts, speechStops, agentFinishes])

    expect(effects).toEqual(['arm-silence'])
    expect(state.answerOwed).toBe(false)
  })

  it('скрип в конце реплики не переспрашивается, когда распознавание догнало', () => {
    // Распознавание всплеска приходит с запозданием: если скрип случился перед самым
    // концом реплики, на response.done мы ещё не знаем, что слов в нём не было. Страховка
    // заведётся, но пустой транскрипт снимет её раньше, чем она попросит ответ.
    const afterReply = play([agentStarts, speechStarts, speechStops, agentFinishes])
    expect(afterReply.effects).toEqual(['arm-silence'])

    const { effects } = play([transcribed('.')], afterReply.state)
    expect(effects).toEqual(['clear-silence'])
  })

  it('не просит ответ, если сервер сам создал реплику на речь поверх агента', () => {
    const { effects } = play([
      agentStarts,
      speechStarts,
      speechStops,
      agentStarts,
      agentFinishes,
    ])

    expect(effects).toEqual([])
  })

  it('не влезает в кандидата, который ещё говорит, когда агент договорил', () => {
    const { state, effects } = play([agentStarts, speechStarts, agentFinishes])

    expect(effects).toEqual([])
    expect(state.candidateSpeaking).toBe(true)
  })

  it('ответ кандидата не теряется, если он договорил уже после реплики агента', () => {
    // Долг тут не нужен и не заводится: агент уже молчит, и обычная тишина после
    // speech_stopped сама доведёт дело до ответа.
    const { state, effects } = play([agentStarts, speechStarts, agentFinishes, speechStops])

    expect(effects).toEqual(['arm-silence'])
    expect(state.answerOwed).toBe(false)
  })

  it('заводит таймеры тишины, когда кандидат договорил в тишину', () => {
    const { effects } = play([speechStarts, speechStops])

    expect(effects).toEqual(['arm-silence'])
  })

  it('снимает таймеры, когда кандидат заговорил', () => {
    const { effects } = play([speechStarts, speechStops, speechStarts])

    expect(effects).toEqual(['clear-silence'])
  })

  it('снимает таймеры, когда агент заговорил сам', () => {
    const { effects } = play([speechStarts, speechStops, agentStarts])

    expect(effects).toEqual(['clear-silence'])
  })

  it('отменяет заведённые таймеры, когда во всплеске не оказалось слов', () => {
    // Шорох дошёл до распознавателя и вернулся без единой буквы. Агента об этом
    // спрашивать нечего: кандидат ничего не сказал.
    const { effects } = play([speechStarts, speechStops, transcribed('.')])

    expect(effects).toEqual(['clear-silence'])
  })

  it('снимает долг, если поверх агента прозвучал шум, а не речь', () => {
    const { effects } = play([
      agentStarts,
      speechStarts,
      speechStops,
      transcribed('?'),
      agentFinishes,
    ])

    expect(effects).toEqual([])
  })

  it('оставляет всё как есть, когда во всплеске были слова', () => {
    const { state, effects } = play([speechStarts, speechStops, transcribed('Yes, I did.')])

    expect(effects).toEqual([])
    expect(state.answerOwed).toBe(false)
  })

  it('не реагирует на посторонние события', () => {
    const { state, effects } = play([{ type: 'response.output_audio_transcript.delta' }])

    expect(effects).toEqual([])
    expect(state).toBe(INITIAL_FLOOR)
  })
})

describe('askForResponse', () => {
  it('просит ответ, когда агент молчит', () => {
    expect(askForResponse(INITIAL_FLOOR).effects).toEqual(['request-response'])
  })

  it('не обрывает агента, а записывает долг', () => {
    // Кандидат отпустил рацию, пока агент говорил. Реплику агента это оборвать не должно.
    const { state, effects } = askForResponse({ ...INITIAL_FLOOR, agentSpeaking: true })

    expect(effects).toEqual([])
    expect(state.answerOwed).toBe(true)
    // Долг не теряется: как только агент договорит, заводится страховка тишины.
    expect(nextFloor(state, { type: 'response.done' }).effects).toEqual(['arm-silence'])
  })
})

describe('isQuiet', () => {
  it.each([
    ['никто не говорит', INITIAL_FLOOR, true],
    ['агент говорит', { ...INITIAL_FLOOR, agentSpeaking: true }, false],
    ['кандидат говорит', { ...INITIAL_FLOOR, candidateSpeaking: true }, false],
  ])('%s → %s', (_label, state, quiet) => {
    expect(isQuiet(state)).toBe(quiet)
  })
})
