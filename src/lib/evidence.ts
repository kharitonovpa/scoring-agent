import type { Evidence, Turn } from './types'

/** Сравниваем по сути, а не по форме: ASR и модель по-разному ставят пунктуацию и регистр. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Чувствительный микрофон превращает шорох, кашель и задетые волосы в отдельную реплику
 * из одного-двух звуков. Распознаватель честно приписывает им какой-нибудь текст, и
 * получается реплика кандидата, которой он не произносил.
 *
 * Опорой такое быть не может: по обрывку в четверть секунды нельзя показать ни структуру
 * ответа, ни уровень языка. Порог низкий намеренно — короткое «Yes» остаётся полноценным
 * ответом, отсекается только то, что физически не успело быть словом.
 */
export const MIN_EVIDENCE_TURN_SEC = 0.4

/**
 * Цитата подтверждена, только если её текст действительно есть в указанной реплике кандидата.
 * Реплики агента опорой быть не могут: оценивается кандидат.
 */
export function validateEvidence(evidence: Evidence[], turns: Turn[]): Evidence[] {
  const candidateText = new Map(
    turns
      .filter((t) => t.speaker === 'candidate' && t.tEnd - t.tStart >= MIN_EVIDENCE_TURN_SEC)
      .map((t) => [t.id, normalize(t.text)]),
  )
  return evidence.filter((e) => {
    const quote = normalize(e?.quote ?? '')
    if (!quote) return false
    const source = candidateText.get(e.turnId)
    return !!source && source.includes(quote)
  })
}

/**
 * Утверждение без подтверждённой опоры выбрасывается целиком — это ядро задачи.
 * Частично выдуманный набор цитат чистится, а само утверждение сохраняется.
 */
export function keepSupported<T extends { evidence: Evidence[] }>(items: T[], turns: Turn[]) {
  const kept: T[] = []
  let dropped = 0
  for (const item of items) {
    const evidence = validateEvidence(item.evidence ?? [], turns)
    if (evidence.length === 0) {
      dropped++
      continue
    }
    kept.push({ ...item, evidence })
  }
  return { kept, dropped }
}
