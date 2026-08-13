import { describe, expect, it } from 'vitest'
import { FAREWELL_INSTRUCTIONS, farewellRequest, isEndInterviewCall, readSpeechState } from '@/lib/agent-signals'
import { buildSessionConfig } from '@/lib/realtime-session'

describe('isEndInterviewCall', () => {
  it('узнаёт вызов в событии аргументов', () => {
    expect(
      isEndInterviewCall({ type: 'response.function_call_arguments.done', name: 'end_interview' }),
    ).toBe(true)
  })

  it('узнаёт вызов в завершённой реплике', () => {
    expect(
      isEndInterviewCall({
        type: 'conversation.item.done',
        item: { type: 'function_call', name: 'end_interview' },
      }),
    ).toBe(true)
  })

  it('не срабатывает на другом инструменте', () => {
    expect(
      isEndInterviewCall({ type: 'response.function_call_arguments.done', name: 'something_else' }),
    ).toBe(false)
    expect(
      isEndInterviewCall({
        type: 'conversation.item.done',
        item: { type: 'message', name: 'end_interview' },
      }),
    ).toBe(false)
  })

  it('не срабатывает на обычных событиях разговора', () => {
    for (const type of [
      'response.done',
      'conversation.item.input_audio_transcription.completed',
      'input_audio_buffer.speech_started',
    ]) {
      expect(isEndInterviewCall({ type })).toBe(false)
    }
  })
})

describe('конфиг сессии', () => {
  const config = buildSessionConfig('unimatch-default', 'Pavel')

  it('даёт агенту инструмент завершения разговора', () => {
    const tool = config.tools.find((t) => t.name === 'end_interview')
    expect(tool).toBeDefined()
    expect(tool!.type).toBe('function')
    expect(config.tool_choice).toBe('auto')
  })

  it('велит прощаться вслух до вызова инструмента', () => {
    expect(config.instructions).toMatch(/closing words out loud first/)
    expect(config.instructions).toMatch(/end_interview/)
  })
})

describe('состояние речи кандидата', () => {
  it('различает начало и конец речи', () => {
    expect(readSpeechState({ type: 'input_audio_buffer.speech_started' })).toBe('started')
    expect(readSpeechState({ type: 'input_audio_buffer.speech_stopped' })).toBe('stopped')
  })

  it('на прочих событиях молчит, чтобы не сбить состояние', () => {
    for (const type of ['response.done', 'conversation.item.added', 'session.updated']) {
      expect(readSpeechState({ type })).toBeNull()
    }
  })
})

describe('просьба попрощаться', () => {
  it('переопределяет инструкции только на один ответ', () => {
    const request = farewellRequest()
    expect(request.type).toBe('response.create')
    expect(request.response.instructions).toBe(FAREWELL_INSTRUCTIONS)
  })

  it('велит сначала отозваться на сказанное, потом прощаться, потом закрыть звонок', () => {
    const order = ['react in one short sentence', 'thank them by name', 'end_interview']
    let at = -1
    for (const fragment of order) {
      const next = FAREWELL_INSTRUCTIONS.indexOf(fragment)
      expect(next, fragment).toBeGreaterThan(at)
      at = next
    }
  })

  it('запрещает новые вопросы и упоминание лимитов вслух', () => {
    expect(FAREWELL_INSTRUCTIONS).toMatch(/Do not ask another question/)
    expect(FAREWELL_INSTRUCTIONS).toMatch(/Never mention time limits/)
  })
})
