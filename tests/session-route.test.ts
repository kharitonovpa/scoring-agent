import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSession = vi.fn(async () => 'sess-1')
const countSessionsSince = vi.fn(async () => 0)

vi.mock('@/lib/db', () => ({ createSession, countSessionsSince }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/session/route')
  return POST(new Request('http://x/api/session', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  createSession.mockResolvedValue('sess-1')
  countSessionsSince.mockResolvedValue(0)
})

describe('POST /api/session', () => {
  it('требует имя кандидата', async () => {
    expect((await post({ candidateName: '  ' })).status).toBe(400)
  })

  it('возвращает только id сессии — ключей клиенту не выдаётся', async () => {
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sessionId: 'sess-1' })
  })

  it('отбивает неизвестную роль до начала разговора', async () => {
    const res = await post({ candidateName: 'Pavel', roleId: 'no-such-role' })
    expect(res.status).toBe(400)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('честно отказывает при исчерпанном часовом лимите, не создавая сессию', async () => {
    countSessionsSince.mockResolvedValue(30)
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(429)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('400 на мусорном теле', async () => {
    const { POST } = await import('@/app/api/session/route')
    const res = await POST(new Request('http://x/api/session', { method: 'POST', body: 'not json' }))
    expect(res.status).toBe(400)
  })
})
