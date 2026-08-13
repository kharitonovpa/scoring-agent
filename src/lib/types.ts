export type Speaker = 'agent' | 'candidate'

export type Turn = {
  /** itemId из Realtime; на него ссылаются цитаты в карточке */
  id: string
  speaker: Speaker
  text: string
  /** секунды от начала аудио сессии */
  tStart: number
  tEnd: number
  timingSource: 'server' | 'client'
}

export type SessionStatus = 'live' | 'interrupted' | 'analyzing' | 'analyzed' | 'failed'

export type Pause = { turnId: string; pauseSec: number }

export type Metrics = {
  durationSec: number
  candidateSpeechSec: number
  agentSpeechSec: number
  candidateSharePct: number
  candidateTurnCount: number
  pauses: Pause[]
  medianPauseSec: number
  longestPauseSec: number
}

export type Evidence = { turnId: string; quote: string }

export type Answered = 'yes' | 'partial' | 'off_topic'

export type QuestionCoverage = {
  questionId: string
  questionLabel: string
  answered: Answered
  note: string
  evidence: Evidence[]
}

export type StarElement = { present: boolean; note: string; evidence: Evidence[] }

export type StructureBlock = {
  summary: string
  coverage: QuestionCoverage[]
  example: { situation: StarElement; action: StarElement; result: StarElement }
}

export type CefrBand = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export type SubscoreName = 'grammar' | 'vocabulary' | 'coherence'

export type CefrSubscore = {
  name: SubscoreName
  band: CefrBand
  note: string
  evidence: Evidence[]
}

export type LanguageBlock = {
  summary: string
  rangeLow: CefrBand
  rangeHigh: CefrBand
  subscores: CefrSubscore[]
}

/** Оценка не выдаётся, когда речи кандидата слишком мало, чтобы её обосновать. */
export type Insufficient = { insufficient: true; reason: string }

export type Confidence = 'low' | 'medium' | 'high'

export type DeliverySignal = {
  label: string
  confidence: Confidence
  whatToCheck: string
  evidence: Evidence[]
}

export type DeliveryBlock = { summary: string; signals: DeliverySignal[] }

/**
 * Факты — список, а не объект с зашитыми полями: набор задаётся конфигом роли, и
 * добавление факта не должно требовать правки типов, схемы и вёрстки.
 */
export type Fact = { id: string; label: string; value: string | null; evidence: Evidence[] }

export type Facts = Fact[]

export type AskedTopic = { topic: string; note: string; evidence: Evidence[] }

/** О чём кандидат спросил сам. Признак вовлечённости, а не оценка человека. */
export type CuriosityBlock = { summary: string; asked: AskedTopic[] }

export type Card = {
  curiosity: CuriosityBlock
  facts: Facts
  structure: StructureBlock
  language: LanguageBlock | Insufficient
  delivery: DeliveryBlock | Insufficient
  droppedClaims: number
}

export const isInsufficient = (block: unknown): block is Insufficient =>
  !!block && (block as Insufficient).insufficient === true

export type SessionRecord = {
  id: string
  candidateName: string
  roleId: string
  consentAt: string
  status: SessionStatus
  startedAt: string
  endedAt: string | null
  transcript: Turn[]
  metrics: Metrics | null
  card: Card | null
  /** Сырые чанки записи по порядку. */
  audioChunks: string[]
  /** Перематываемый файл после ремукса — именно его играет карточка. */
  audioUrl: string | null
  /** Какой секунде серверной шкалы соответствует нулевая секунда файла записи. */
  audioOffsetSec: number | null
}
