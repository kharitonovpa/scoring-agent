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
  process.env.OPENAI_API_KEY = 'sk-test'
  createSession.mockResolvedValue('sess-1')
  countSessionsSince.mockResolvedValue(0)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ value: 'ek_123' }), { status: 200 })),
  )
})

describe('POST /api/session', () => {
  it('требует имя кандидата', async () => {
    expect((await post({ candidateName: '  ' })).status).toBe(400)
  })

  it('возвращает эфемерный ключ и id сессии', async () => {
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sessionId: 'sess-1', clientSecret: 'ek_123' })
  })

  it('отдаёт понятную ошибку, когда OpenAI отказал', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/OpenAI/)
  })

  it('не создаёт сессию, когда OpenAI отказал', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))
    await post({ candidateName: 'Pavel' })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('честно отказывает при исчерпанном часовом лимите, не создавая сессию', async () => {
    countSessionsSince.mockResolvedValue(30)
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(429)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('не кладёт рубрику оценки в инструкции сессии и включает транскрипцию', async () => {
    await post({ candidateName: 'Pavel' })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.session.instructions.toLowerCase()).not.toContain('cefr')
    expect(body.session.audio.input.transcription.model).toBe('gpt-4o-transcribe')
    expect(body.session.model).toBe('gpt-realtime-2.1')
  })
})
