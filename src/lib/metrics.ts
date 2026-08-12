import type { Metrics, Pause, Turn } from './types'

const round = (n: number) => Math.round(n * 100) / 100

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Только нейтральные факты о разговоре. Темп речи здесь сознательно не считается:
 * оценка по темпу запрещена спецификацией.
 */
export function computeMetrics(turns: Turn[]): Metrics {
  const ordered = [...turns].sort((a, b) => a.tStart - b.tStart)
  const speech = (speaker: Turn['speaker']) =>
    round(
      ordered
        .filter((t) => t.speaker === speaker)
        .reduce((sum, t) => sum + Math.max(0, t.tEnd - t.tStart), 0),
    )

  const candidateSpeechSec = speech('candidate')
  const agentSpeechSec = speech('agent')
  const total = candidateSpeechSec + agentSpeechSec

  const pauses: Pause[] = []
  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i]
    const previous = ordered[i - 1]
    if (current.speaker !== 'candidate' || previous.speaker !== 'agent') continue
    pauses.push({ turnId: current.id, pauseSec: round(Math.max(0, current.tStart - previous.tEnd)) })
  }

  const pauseValues = pauses.map((p) => p.pauseSec)
  return {
    durationSec: ordered.length ? round(Math.max(...ordered.map((t) => t.tEnd))) : 0,
    candidateSpeechSec,
    agentSpeechSec,
    candidateSharePct: total ? Math.round((candidateSpeechSec / total) * 100) : 0,
    candidateTurnCount: ordered.filter((t) => t.speaker === 'candidate').length,
    pauses,
    medianPauseSec: median(pauseValues),
    longestPauseSec: pauseValues.length ? Math.max(...pauseValues) : 0,
  }
}

export const MIN_CANDIDATE_SPEECH_SEC = 60
export const MIN_CANDIDATE_TURNS = 3

/**
 * Порог, ниже которого оценку уровня языка и манеры речи выдавать нечестно.
 * Оба условия обязательны: одна длинная реплика — это один ответ, а не разговор.
 */
export function hasEnoughSpeech(metrics: Metrics): boolean {
  return (
    metrics.candidateSpeechSec >= MIN_CANDIDATE_SPEECH_SEC &&
    metrics.candidateTurnCount >= MIN_CANDIDATE_TURNS
  )
}
