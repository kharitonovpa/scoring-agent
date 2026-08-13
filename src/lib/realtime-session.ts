import { END_INTERVIEW_TOOL } from '@/lib/closing'
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
    // Без этого агент, задав все вопросы, просто замолкает, и кандидат не понимает,
    // кончилось интервью или нет. Инструментом он завершает разговор сам.
    tools: [
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
