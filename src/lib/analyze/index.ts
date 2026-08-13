import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'
import { keepSupported, validateEvidence } from '../evidence'
import {
  computeMetrics,
  hasEnoughSpeech,
  MIN_CANDIDATE_SPEECH_SEC,
  MIN_CANDIDATE_TURNS,
} from '../metrics'
import { loadRole } from '../roles'
import type { Card, Evidence, Facts, Metrics, Turn } from '../types'
import {
  deliveryPrompt,
  factsPrompt,
  languagePrompt,
  renderTranscript,
  structurePrompt,
} from './prompts'
import { DeliveryResult, FactsResult, LanguageResult, StructureResult } from './schemas'

// Клиент создаётся при первом вызове, а не при импорте: иначе сборка требует
// OPENAI_API_KEY на этапе билда, хотя нужен он только в рантайме.
let client: OpenAI | null = null
const openai = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

async function ask<T>(prompt: string, schema: z.ZodType<T>, name: string): Promise<T> {
  const res = await openai().responses.parse({
    model: process.env.OPENAI_ANALYSIS_MODEL!,
    input: prompt,
    text: { format: zodTextFormat(schema, name) },
  })
  const parsed = (res as { output_parsed?: T }).output_parsed
  if (!parsed) throw new Error(`Analysis returned no parsed output for ${name}`)
  return parsed
}

export async function buildCard(input: {
  turns: Turn[]
  roleId: string
}): Promise<{ card: Card; metrics: Metrics }> {
  const { turns } = input
  if (!turns.some((t) => t.speaker === 'candidate')) {
    throw new Error('No candidate turns in this conversation — nothing to analyse')
  }

  const role = loadRole(input.roleId)
  const metrics = computeMetrics(turns)
  const transcript = renderTranscript(turns)

  // Уровень языка и манеру речи по сорока секундам речи оценивать нечестно, поэтому
  // при нехватке данных эти два вызова просто не делаются — экономим и деньги, и обман.
  const enough = hasEnoughSpeech(metrics)
  const shortfall =
    `Английской речи кандидата ${Math.round(metrics.candidateSpeechSec)} с в ` +
    `${metrics.candidateTurnCount} репл.; для обоснованной оценки нужно от ` +
    `${MIN_CANDIDATE_SPEECH_SEC} с и от ${MIN_CANDIDATE_TURNS} реплик.`

  const [rawStructure, rawLanguage, rawDelivery, rawFacts] = await Promise.all([
    ask(structurePrompt(role, transcript), StructureResult, 'structure_analysis'),
    enough ? ask(languagePrompt(transcript, role.minutes), LanguageResult, 'language_analysis') : null,
    enough ? ask(deliveryPrompt(transcript, metrics), DeliveryResult, 'delivery_analysis') : null,
    ask(factsPrompt(role, transcript), FactsResult, 'facts_extraction'),
  ])

  let dropped = 0

  const labelOf = (questionId: string) =>
    role.questions.find((q) => q.id === questionId)?.label ?? questionId

  const coverage = keepSupported(rawStructure.coverage, turns)
  dropped += coverage.dropped

  const star = (element: { present: boolean; note: string; evidence: Evidence[] }) => {
    const evidence = validateEvidence(element.evidence, turns)
    if (evidence.length === 0) {
      dropped++
      return { present: false, note: 'Не подтверждено цитатой из разговора.', evidence: [] }
    }
    return { ...element, evidence }
  }

  // Порядок и состав задаёт конфиг роли, а не модель: лишние идентификаторы игнорируются,
  // пропущенные превращаются в «не прозвучало». Так добавление факта в конфиг не требует
  // ни правки кода, ни доверия к тому, что модель вернула ровно запрошенный набор.
  const facts: Facts = role.facts.map((declared) => {
    const raw = rawFacts.facts.find((f) => f.id === declared.id)
    const evidence = raw ? validateEvidence(raw.evidence, turns) : []
    if (evidence.length === 0) {
      if (raw?.value) dropped++
      return { id: declared.id, label: declared.label, value: null, evidence: [] }
    }
    return { id: declared.id, label: declared.label, value: raw!.value, evidence }
  })

  let language: Card['language'] = { insufficient: true, reason: shortfall }
  if (rawLanguage) {
    const subscores = keepSupported(rawLanguage.subscores, turns)
    dropped += subscores.dropped
    language = {
      summary: rawLanguage.summary,
      rangeLow: rawLanguage.rangeLow,
      rangeHigh: rawLanguage.rangeHigh,
      subscores: subscores.kept,
    }
  }

  let delivery: Card['delivery'] = { insufficient: true, reason: shortfall }
  if (rawDelivery) {
    const signals = keepSupported(rawDelivery.signals, turns)
    dropped += signals.dropped
    delivery = { summary: rawDelivery.summary, signals: signals.kept }
  }

  const card: Card = {
    facts,
    structure: {
      summary: rawStructure.summary,
      coverage: coverage.kept.map((c) => ({ ...c, questionLabel: labelOf(c.questionId) })),
      example: {
        situation: star(rawStructure.example.situation),
        action: star(rawStructure.example.action),
        result: star(rawStructure.example.result),
      },
    },
    language,
    delivery,
    droppedClaims: dropped,
  }

  return { card, metrics }
}
