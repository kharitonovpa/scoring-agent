import type { Turn } from './types'

export type StampedEvent = { clientTimeSec: number; event: Record<string, unknown> }

type Timing = { tStart?: number; tEnd?: number }

/**
 * Единственные события, которые могут изменить набор реплик. Остальное — потоковые
 * `delta`, их за разговор прилетают тысячи, и пересобирать транскрипт на каждом значит
 * получить квадратичный рост работы: к середине разговора страница встаёт.
 */
export const TURN_EVENT_TYPES = new Set([
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'conversation.item.input_audio_transcription.completed',
  'response.output_audio_transcript.done',
])

/** Меняет ли это событие транскрипт. */
export function affectsTurns(event: Record<string, unknown>): boolean {
  return typeof event.type === 'string' && TURN_EVENT_TYPES.has(event.type)
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/**
 * Тайминги кандидата берутся из VAD-событий (серверные, в мс от начала аудио сессии)
 * и склеиваются с текстом по item_id. Для агента серверных таймингов не существует,
 * поэтому его реплики переводятся на ту же шкалу через сдвиг, замеренный на первом
 * совпадении серверного и клиентского времени.
 */
export function assembleTurns(events: StampedEvent[]): Turn[] {
  const timings = new Map<string, Timing>()
  let offset: number | null = null

  for (const { clientTimeSec, event } of events) {
    const type = str(event.type)
    const itemId = str(event.item_id)
    if (!itemId) continue

    if (type === 'input_audio_buffer.speech_started') {
      const ms = num(event.audio_start_ms)
      if (ms === undefined) continue
      const tStart = ms / 1000
      timings.set(itemId, { ...timings.get(itemId), tStart })
      if (offset === null) offset = tStart - clientTimeSec
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      const ms = num(event.audio_end_ms)
      if (ms === undefined) continue
      timings.set(itemId, { ...timings.get(itemId), tEnd: ms / 1000 })
    }
  }

  const shift = (clientTimeSec: number) => Math.max(0, clientTimeSec + (offset ?? 0))
  const turns = new Map<string, Turn>()

  for (const { clientTimeSec, event } of events) {
    const type = str(event.type)
    const itemId = str(event.item_id)
    if (!itemId || turns.has(itemId)) continue

    const isCandidate = type === 'conversation.item.input_audio_transcription.completed'
    const isAgent = type === 'response.output_audio_transcript.done'
    if (!isCandidate && !isAgent) continue

    const text = (str(event.transcript) ?? '').trim()
    if (!text) continue

    const timing = isCandidate ? timings.get(itemId) : undefined
    const hasServerTiming = timing?.tStart !== undefined

    turns.set(itemId, {
      id: itemId,
      speaker: isCandidate ? 'candidate' : 'agent',
      text,
      tStart: hasServerTiming ? timing!.tStart! : shift(clientTimeSec),
      tEnd: timing?.tEnd ?? shift(clientTimeSec),
      timingSource: hasServerTiming ? 'server' : 'client',
    })
  }

  return [...turns.values()].sort((a, b) => a.tStart - b.tStart)
}

/**
 * Тайминги реплик отсчитываются от начала аудио сессии на стороне OpenAI, а запись
 * началась в свой собственный момент. Функция возвращает, какой секунде серверной шкалы
 * соответствует нулевая секунда файла записи: вычитая это значение из tStart, получаем
 * позицию фрагмента в файле. Без этой поправки цитата играет не те слова.
 */
export function computeAudioOffset(
  events: StampedEvent[],
  recordingStartClientSec: number,
): number | null {
  for (const { clientTimeSec, event } of events) {
    if (str(event.type) !== 'input_audio_buffer.speech_started') continue
    const ms = num(event.audio_start_ms)
    if (ms === undefined) continue
    const serverZeroClientSec = clientTimeSec - ms / 1000
    return recordingStartClientSec - serverZeroClientSec
  }
  return null
}
