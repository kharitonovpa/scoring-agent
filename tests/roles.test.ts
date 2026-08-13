import { describe, expect, it } from 'vitest'
import { buildInstructions, loadRole, roleTitle } from '@/lib/roles'

describe('roles', () => {
  it('загружает конфиг роли', () => {
    const role = loadRole('unimatch-default')
    expect(role.questions).toHaveLength(4)
    expect(role.questions[0].id).toBe('location')
  })

  it('падает на неизвестной роли', () => {
    expect(() => loadRole('nope')).toThrow(/nope/)
  })

  it('инструкции содержат все вопросы и требование говорить по-английски', () => {
    const role = loadRole('unimatch-default')
    const text = buildInstructions(role)
    for (const q of role.questions) {
      expect(text).toContain(q.ask)
    }
    expect(text).toMatch(/English/)
  })

  it('инструкции не содержат рубрику оценки: клиент может их переопределить', () => {
    const text = buildInstructions(loadRole('unimatch-default')).toLowerCase()
    for (const forbidden of ['cefr', 'score', 'rubric', 'assess', 'evaluate']) {
      expect(text).not.toContain(forbidden)
    }
  })
})

describe('вопросы пригодны для голосового разговора', () => {
  const role = loadRole('unimatch-default')

  it('каждый ask — один вопрос, а не два в одном предложении', () => {
    for (const q of role.questions) {
      // Два вопросительных знака означают, что агенту придётся нарушить либо
      // «спрашивай по одному», либо потерять половину вопроса.
      expect(q.ask.split('?').length - 1, `вопрос ${q.id}`).toBeLessThanOrEqual(1)
    }
  })

  it('у каждого вопроса есть тема для кандидата', () => {
    for (const q of role.questions) expect(q.topic, `вопрос ${q.id}`).toBeTruthy()
  })

  it('второй шаг вопроса про опыт задаётся отдельно', () => {
    const experience = role.questions.find((q) => q.id === 'experience')!
    expect(experience.followUp).toBeTruthy()
    expect(buildInstructions(role)).toMatch(/Once they have answered that, then ask/)
  })

  it('роль имеет человеческое название для интерфейса', () => {
    expect(roleTitle('unimatch-default')).toBe('Student Success Manager')
    expect(roleTitle('нет-такой')).toBe('нет-такой')
  })
})
