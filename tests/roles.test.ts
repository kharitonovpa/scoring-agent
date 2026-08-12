import { describe, expect, it } from 'vitest'
import { buildInstructions, loadRole } from '@/lib/roles'

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
