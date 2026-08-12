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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function ask<T>(prompt: string, schema: z.ZodType<T>, name: string): Promise<T> {
  const res = await client.responses.parse({
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
    enough ? ask(languagePrompt(transcript), LanguageResult, 'language_analysis') : null,
    enough ? ask(deliveryPrompt(transcript, metrics), DeliveryResult, 'delivery_analysis') : null,
    ask(factsPrompt(transcript), FactsResult, 'facts_extraction'),
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

  const facts = Object.fromEntries(
    (['location', 'workRight', 'domainExperience', 'workFormat', 'startDate'] as const).map(
      (key) => {
        const fact = rawFacts[key]
        const evidence = validateEvidence(fact.evidence, turns)
        if (evidence.length === 0) {
          if (fact.value) dropped++
          return [key, { value: null, evidence: [] }]
        }
        return [key, { value: fact.value, evidence }]
      },
    ),
  ) as Facts

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
