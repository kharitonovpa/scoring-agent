import { END_INTERVIEW_TOOL, QUESTION_STARTED_TOOL } from '@/lib/agent-signals'
import { buildInstructions, loadRole } from '@/lib/roles'

/**
 * Конфиг разговора собирается только здесь и только на сервере. При схеме с эфемерным
 * ключом клиент технически мог переопределить сессию, привязанную к ключу; при обмене SDP
 * через наш сервер конфиг уходит в OpenAI вместе с оффером, и подменить его нельзя.
 */
export function buildSessionConfig(roleId: string, candidateName: string) {
  const role = loadRole(roleId)
  return {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    instructions: `${buildInstructions(role)}\n\nThe candidate's name is ${candidateName}.`,
    audio: {
      input: {
        // Язык задан жёстко. Без него распознаватель определяет язык сам и на шорохах
        // выдаёт текст на случайном языке — в карточку попадали строки кириллицей,
        // которых кандидат не произносил. Интервью английское, догадки здесь не нужны.
        transcription: { model: 'gpt-4o-transcribe', language: 'en' },
        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
      },
      output: { voice: 'marin' },
    },
    reasoning: { effort: 'low' },
    // Два служебных инструмента. О прогрессе и о завершении сообщает сам агент: он один
    // знает, где находится в списке. Выводить это из транскрипта значило бы угадывать по
    // формулировкам, а они меняются от разговора к разговору.
    tools: [
      {
        type: 'function',
        name: QUESTION_STARTED_TOOL,
        description:
          'Call this each time you move on to a new question from the list, right before you ask it. It only updates the progress indicator the candidate sees; it changes nothing in the conversation and needs no reply.',
        parameters: {
          type: 'object',
          // Список идентификаторов берётся из конфига роли: добавили вопрос — агент
          // сразу может о нём сообщить, править код для этого не нужно.
          properties: {
            questionId: { type: 'string', enum: role.questions.map((q) => q.id) },
          },
          required: ['questionId'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: END_INTERVIEW_TOOL,
        description:
          'Call this immediately after you have said goodbye, to end the interview and let the candidate go. Do not call it before you have said your closing words out loud.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    tool_choice: 'auto',
  }
}
