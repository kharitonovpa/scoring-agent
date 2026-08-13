import { hasWords } from './turns'

/**
 * Кто держит слово в разговоре.
 *
 * Вынесено из хука отдельной чистой функцией по одной причине: цена ошибки здесь —
 * оборванная на полуслове реплика агента, а на живом разговоре это не воспроизвести.
 * Правила очерёдности должны проверяться тестом, а не отловом на кандидате.
 *
 * Главное правило: пока агент говорит, мы не просим его отвечать. `interrupt_response:
 * false` защищает только от серверного VAD — наш собственный `response.create`, посланный
 * в середину реплики, обрывает её так же, как перебивание.
 */
export type FloorState = {
  /** Агент производит реплику — от `response.created` до `response.done`. */
  agentSpeaking: boolean
  /** Кандидат говорит прямо сейчас. */
  candidateSpeaking: boolean
  /**
   * Кандидат ответил поверх реплики агента. При `interrupt_response: false` сервер может
   * не создать реплику на такой ответ — тогда разговор встанет в тишине, и спросить
   * придётся нам. Но не раньше, чем агент договорит.
   */
  answerOwed: boolean
}

export const INITIAL_FLOOR: FloorState = {
  agentSpeaking: false,
  candidateSpeaking: false,
  answerOwed: false,
}

/**
 * Что делать по итогам события.
 *
 * `request-response` — попросить агента ответить сейчас же.
 * `arm-silence` — завести то, что заполняет тишину: страховку на случай молчания сервера
 * и кнопку «я договорил».
 * `clear-silence` — снять их: тишины больше нет.
 */
export type FloorEffect = 'request-response' | 'arm-silence' | 'clear-silence'

type Step = { state: FloorState; effects: FloorEffect[] }

/**
 * Тихо ли в разговоре: не говорит ни агент, ни кандидат. Вставлять свою реплику —
 * например, просьбу попрощаться — можно только в такой момент. Просьба посреди реплики
 * агента не перебивает его, а возвращает ошибку «response already active» и молча
 * теряется.
 */
export function isQuiet(state: FloorState): boolean {
  return !state.agentSpeaking && !state.candidateSpeaking
}

/**
 * Кандидат сам обозначил конец реплики — отпустил рацию или нажал «я договорил». Просить
 * ответ можно, только если агент молчит; иначе это тот же обрыв реплики, что и от шума,
 * только инициированный человеком. Ждём `response.done` — долг заберут там.
 */
export function askForResponse(state: FloorState): Step {
  if (state.agentSpeaking) return { state: { ...state, answerOwed: true }, effects: [] }
  return { state, effects: ['request-response'] }
}

export function nextFloor(state: FloorState, event: Record<string, unknown>): Step {
  switch (event.type) {
    case 'input_audio_buffer.speech_started':
      // Кандидат заговорил — тишины нет, ждать нечего.
      return { state: { ...state, candidateSpeaking: true }, effects: ['clear-silence'] }

    case 'input_audio_buffer.speech_stopped': {
      const candidate = { ...state, candidateSpeaking: false }
      // Всплеск закончился, пока агент говорил. Ни просить ответ, ни показывать кнопку:
      // тишины нет, а спрашивать поверх реплики значит её оборвать. Запоминаем долг —
      // возможно, это был ответ кандидата, и сервер его проглотил.
      if (state.agentSpeaking) return { state: { ...candidate, answerOwed: true }, effects: [] }
      return { state: candidate, effects: ['arm-silence'] }
    }

    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = typeof event.transcript === 'string' ? event.transcript : ''
      // Слова во всплеске были — это речь, всё идёт своим ходом.
      if (hasWords(transcript)) return { state, effects: [] }
      // Слов нет: скрип, кашель, задетый микрофон. Распознаватель обязан выдать текст на
      // любой звук, и это единственное надёжное «кандидат ничего не сказал», которое у нас
      // есть — VAD такого различения не даёт. Шум не заводит таймеры и не создаёт долга.
      return { state: { ...state, answerOwed: false }, effects: ['clear-silence'] }
    }

    case 'response.created':
      // Агент заговорил сам — заполнять тишину больше нечем, и долг закрыт.
      return {
        state: { ...state, agentSpeaking: true, answerOwed: false },
        effects: ['clear-silence'],
      }

    case 'response.done': {
      const idle = { ...state, agentSpeaking: false }
      // Кандидат всё ещё говорит: долг остаётся за ним, его закроет тишина после того,
      // как он договорит.
      if (state.candidateSpeaking) return { state: idle, effects: [] }
      if (state.answerOwed) {
        // Ответ не просим сразу, а заводим страховку тишины. Причин две: сервер может
        // сам создать реплику на слова поверх агента — тогда `response.created` снимет
        // страховку и второго ответа не будет; а если всплеск был шумом, распознавание
        // которого ещё не успело прийти, пустой транскрипт снимет её раньше, чем агент
        // переспросит скрип двери.
        return { state: { ...idle, answerOwed: false }, effects: ['arm-silence'] }
      }
      // Агент договорил в тишину — слово у кандидата, и торопить его нечем. Кнопка «я
      // договорил» появляется только после того, как он начал и закончил говорить.
      return { state: idle, effects: [] }
    }

    default:
      return { state, effects: [] }
  }
}
