export const END_INTERVIEW_TOOL = 'end_interview'
export const QUESTION_STARTED_TOOL = 'question_started'

/** Разбирает аргументы вызова инструмента — в GA-схеме это строка с JSON. */
function readArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Прогресс сообщает сам агент: он один знает, к какому вопросу перешёл. Выводить это из
 * транскрипта означало бы угадывать по формулировкам, а они меняются от разговора к
 * разговору. Возвращает идентификатор вопроса или null, если событие про другое.
 */
export function readQuestionStarted(event: Record<string, unknown>): string | null {
  const fromArgs = (raw: unknown) => {
    const id = readArguments(raw).questionId
    return typeof id === 'string' && id ? id : null
  }

  if (event.type === 'response.function_call_arguments.done' && event.name === QUESTION_STARTED_TOOL) {
    return fromArgs(event.arguments)
  }
  if (event.type === 'conversation.item.done') {
    const item = event.item as { type?: string; name?: string; arguments?: unknown } | undefined
    if (item?.type === 'function_call' && item.name === QUESTION_STARTED_TOOL) {
      return fromArgs(item.arguments)
    }
  }
  return null
}

/**
 * Агент сообщает о конце разговора вызовом инструмента. GA-схема присылает это событием
 * `response.function_call_arguments.done`, но тот же вызов дублируется в завершённой
 * реплике — принимаем оба вида, чтобы завершение не зависело от одной формы события.
 */
export function isEndInterviewCall(event: Record<string, unknown>): boolean {
  if (event.type === 'response.function_call_arguments.done') {
    return event.name === END_INTERVIEW_TOOL
  }
  if (event.type === 'conversation.item.done') {
    const item = event.item as { type?: string; name?: string } | undefined
    return item?.type === 'function_call' && item.name === END_INTERVIEW_TOOL
  }
  return false
}

/**
 * Говорит ли кандидат прямо сейчас. Нужно, чтобы не влезть в середину его фразы с
 * прощанием: обрывать человека на полуслове — худшее, чем можно закончить собеседование.
 */
export function readSpeechState(event: Record<string, unknown>): 'started' | 'stopped' | null {
  if (event.type === 'input_audio_buffer.speech_started') return 'started'
  if (event.type === 'input_audio_buffer.speech_stopped') return 'stopped'
  return null
}

/**
 * Инструкция на один ответ. Постоянные инструкции агента не переписываются: сессионный
 * конфиг живёт на сервере и клиенту недоступен — здесь только просьба закрыть разговор.
 */
export const FAREWELL_INSTRUCTIONS =
  'The call has reached its time budget and must end now. Do not ask another question and do not start a new topic. ' +
  'First react in one short sentence to what the candidate just told you, so it does not feel cut off. ' +
  'Then thank them by name, tell them a Unimatch recruiter will follow up by email in the coming days, and wish them well. ' +
  `Then call the ${END_INTERVIEW_TOOL} tool. Never mention time limits, budgets or technical reasons.`

/** Событие, которым просим агента попрощаться. */
export function farewellRequest() {
  return { type: 'response.create', response: { instructions: FAREWELL_INSTRUCTIONS } }
}
