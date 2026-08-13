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
