import { buildCard } from '@/lib/analyze'
import { getSession, saveAnalysis, setStatus } from '@/lib/db'

/**
 * Единственная точка запуска анализа: её зовут и автоматическое завершение интервью,
 * и ручной повтор с карточки. Идемпотентна — повторный вызов перезаписывает результат.
 */
export async function runAnalysis(sessionId: string): Promise<{ droppedClaims: number }> {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`Unknown session: ${sessionId}`)

  if (!session.transcript.some((t) => t.speaker === 'candidate')) {
    await setStatus(sessionId, 'failed')
    throw new Error('No candidate speech in this conversation — nothing to analyse')
  }

  await setStatus(sessionId, 'analyzing')
  try {
    const { card, metrics } = await buildCard({
      turns: session.transcript,
      roleId: session.roleId,
      usedPushToTalk: session.usedPushToTalk,
    })
    await saveAnalysis(sessionId, metrics, card)
    return { droppedClaims: card.droppedClaims }
  } catch (err) {
    await setStatus(sessionId, 'failed')
    throw err
  }
}
