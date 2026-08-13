import { z } from 'zod'

const evidence = z.object({
  turnId: z.string().describe('id реплики КАНДИДАТА из транскрипта'),
  quote: z.string().describe('дословный фрагмент этой реплики'),
})

/**
 * Пустой список допустим намеренно. Требование «минимум одна цитата» проверяет код:
 * схема, обязывающая приложить цитату к каждому полю, вынуждает модель выдумать её
 * там, где сказать нечего.
 */
const evidenceList = z.array(evidence)

const starElement = z.object({
  present: z.boolean(),
  note: z.string(),
  evidence: evidenceList,
})

export const StructureResult = z.object({
  summary: z.string(),
  coverage: z.array(
    z.object({
      questionId: z.string(),
      answered: z.enum(['yes', 'partial', 'off_topic']),
      note: z.string(),
      evidence: evidenceList,
    }),
  ),
  // Список, а не одно поле: примеров столько, сколько вопросов их требуют по конфигу.
  examples: z.array(
    z.object({
      questionId: z.string(),
      situation: starElement,
      action: starElement,
      result: starElement,
    }),
  ),
})

const band = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

export const LanguageResult = z.object({
  summary: z.string(),
  rangeLow: band,
  rangeHigh: band,
  subscores: z.array(
    z.object({
      name: z.enum(['grammar', 'vocabulary', 'coherence']),
      band,
      note: z.string(),
      evidence: evidenceList,
    }),
  ),
})

export const DeliveryResult = z.object({
  summary: z.string(),
  signals: z.array(
    z.object({
      label: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      whatToCheck: z.string(),
      evidence: evidenceList,
    }),
  ),
})

// Нельзя `.optional()`: под strict все поля обязательны, «нет значения» выражается null.
const fact = z.object({
  id: z.string(),
  value: z.string().nullable(),
  evidence: evidenceList,
})

// Идентификатор факта не перечислением, а строкой: набор задаётся конфигом. Неизвестные
// идентификаторы отбрасывает код — там же, где живёт вся остальная проверка.
export const FactsResult = z.object({ facts: z.array(fact) })

export const CuriosityResult = z.object({
  summary: z.string(),
  asked: z.array(
    z.object({ topic: z.string(), note: z.string(), evidence: evidenceList }),
  ),
})
