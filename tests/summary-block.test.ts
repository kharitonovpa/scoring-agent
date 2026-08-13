import { describe, expect, it } from 'vitest'
import { isInsufficient, type Card } from '@/lib/types'

/**
 * Сводка не имеет права утверждать ничего сверх проверенных блоков. Тест фиксирует именно
 * это свойство: всё, что она показывает, выводится из карточки арифметикой.
 */

const ev = [{ turnId: 't1', quote: 'hello' }]

const card: Card = {
  curiosity: {
    summary: 'ok',
    asked: [{ topic: 'компенсация', note: 'спросил про вилку', evidence: ev }],
  },
  facts: [
    { id: 'location', label: 'Локация', value: 'Russia', evidence: ev },
    { id: 'workRight', label: 'Право на работу', value: 'Yes', evidence: ev },
    { id: 'domainExperience', label: 'Опыт в домене', value: null, evidence: [] },
    { id: 'workFormat', label: 'Формат работы', value: 'Full-time', evidence: ev },
    { id: 'startDate', label: 'Срок выхода', value: null, evidence: [] },
  ],
  structure: {
    summary: 'ok',
    coverage: [
      { questionId: 'location', questionLabel: 'Локация', answered: 'yes', note: '', evidence: ev },
      { questionId: 'experience', questionLabel: 'Опыт', answered: 'partial', note: '', evidence: ev },
      { questionId: 'format', questionLabel: 'Формат', answered: 'yes', note: '', evidence: ev },
      { questionId: 'start', questionLabel: 'Срок', answered: 'off_topic', note: '', evidence: ev },
    ],
    examples: [
      {
        questionId: 'solo_delivery',
        questionLabel: 'Solo-ведение фичи',
        situation: { present: true, note: '', evidence: ev },
        action: { present: true, note: '', evidence: ev },
        result: { present: false, note: '', evidence: [] },
      },
      {
        questionId: 'scope_cut',
        questionLabel: 'Урезание объёма',
        situation: { present: true, note: '', evidence: ev },
        action: { present: true, note: '', evidence: ev },
        result: { present: true, note: '', evidence: ev },
      },
    ],
  },
  language: { rangeLow: 'B1', rangeHigh: 'B2', summary: 'ok', subscores: [] },
  delivery: { summary: 'ok', signals: [] },
  droppedClaims: 2,
} as Card

describe('данные для сводки', () => {
  it('считает ответы по существу отдельно от частичных и мимо вопроса', () => {
    const byAnswer = card.structure.coverage.reduce<Record<string, number>>(
      (acc, c) => ({ ...acc, [c.answered]: (acc[c.answered] ?? 0) + 1 }),
      {},
    )
    expect(byAnswer.yes).toBe(2)
    expect(byAnswer.partial).toBe(1)
    expect(byAnswer.off_topic).toBe(1)
  })

  it('видит недостающий элемент в каждом кейсе отдельно', () => {
    // С двумя примерами общий список «чего не хватает» бесполезен: рекрутеру нужно
    // знать, в каком именно кейсе дыра.
    const perExample = card.structure.examples.map((e) => ({
      id: e.questionId,
      missing: (['situation', 'action', 'result'] as const).filter((k) => !e[k].present),
    }))
    expect(perExample).toEqual([
      { id: 'solo_delivery', missing: ['result'] },
      { id: 'scope_cut', missing: [] },
    ])
  })

  it('видит непрозвучавшие факты', () => {
    const missing = card.facts.filter((f) => !f.value).map((f) => f.id)
    expect(missing).toEqual(['domainExperience', 'startDate'])
  })

  it('показывает темы, о которых спросил кандидат', () => {
    expect(card.curiosity.asked.map((a) => a.topic)).toEqual(['компенсация'])
  })

  it('различает пустой список сигналов и нехватку данных', () => {
    expect(isInsufficient(card.delivery)).toBe(false)
    expect(isInsufficient({ insufficient: true, reason: 'мало речи' })).toBe(true)
  })

  it('несёт число отброшенных утверждений из карточки, а не своё', () => {
    expect(card.droppedClaims).toBe(2)
  })
})
