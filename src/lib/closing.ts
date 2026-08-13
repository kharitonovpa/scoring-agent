export const END_INTERVIEW_TOOL = 'end_interview'

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
