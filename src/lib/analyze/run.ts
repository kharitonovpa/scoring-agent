/**
 * Единственная точка запуска анализа: её зовут и автоматическое завершение интервью,
 * и ручной повтор с карточки. Наполняется в задаче 16; здесь — чтобы роут /api/turns
 * был работоспособен и тестируем.
 */
export async function runAnalysis(sessionId: string): Promise<{ droppedClaims: number }> {
  console.warn('runAnalysis is not implemented yet', sessionId)
  return { droppedClaims: 0 }
}
