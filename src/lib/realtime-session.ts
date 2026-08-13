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
        transcription: { model: 'gpt-4o-transcribe' },
        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
      },
      output: { voice: 'marin' },
    },
    reasoning: { effort: 'low' },
  }
}
