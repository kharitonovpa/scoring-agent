import { describe, expect, it } from 'vitest'
import { isEndInterviewCall } from '@/lib/agent-signals'
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
