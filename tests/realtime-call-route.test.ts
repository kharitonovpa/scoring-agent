import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn(async () => ({
  id: 's1',
  candidateName: 'Pavel',
  roleId: 'unimatch-default',
}))

vi.mock('@/lib/db', () => ({ getSession }))

const OFFER = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n'

const post = async (sdp = OFFER, sessionId: string | null = 's1') => {
  const { POST } = await import('@/app/api/realtime/call/route')
  const url = sessionId ? `http://x/api/realtime/call?sessionId=${sessionId}` : 'http://x/api/realtime/call'
  return POST(new Request(url, { method: 'POST', body: sdp }))
}

const sentForm = () => vi.mocked(fetch).mock.calls[0][1]!.body as FormData

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'sk-test'
  getSession.mockResolvedValue({ id: 's1', candidateName: 'Pavel', roleId: 'unimatch-default' })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('ANSWER_SDP', {
          status: 200,
          headers: { Location: '/v1/realtime/calls/rtc_42' },
        }),
    ),
  )
})

describe('POST /api/realtime/call', () => {
  it('отдаёт SDP-ответ и идентификатор звонка', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/sdp')
    expect(res.headers.get('X-Call-Id')).toBe('rtc_42')
    await expect(res.text()).resolves.toBe('ANSWER_SDP')
  })

  it('шлёт оффер и конфиг в OpenAI постоянным ключом сервера', async () => {
    await post()
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/realtime/calls')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(sentForm().get('sdp')).toBe(OFFER)
  })

  it('собирает конфиг сессии на сервере: транскрипция включена, рубрики оценки нет', async () => {
    await post()
    const config = JSON.parse(sentForm().get('session') as string)
    expect(config.model).toBe('gpt-realtime-2.1')
    expect(config.audio.input.transcription.model).toBe('gpt-4o-transcribe')
    expect(config.audio.input.turn_detection.type).toBe('semantic_vad')
    expect(config.instructions).toContain('Pavel')
    expect(config.instructions.toLowerCase()).not.toContain('cefr')
  })

  it('называет отказ по географии своим именем', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'unsupported_country_region_territory' } }), {
            status: 403,
          }),
      ),
    )
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/region/i)
  })

  it('прочие отказы OpenAI не раскрывают деталей клиенту', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).not.toMatch(/quota/)
  })

  it('404 на неизвестной сессии', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await post()).status).toBe(404)
  })

  it('400 без sessionId и на теле, которое не SDP', async () => {
    expect((await post(OFFER, null)).status).toBe(400)
    expect((await post('{"not":"sdp"}')).status).toBe(400)
  })

  it('звук не перебивает агента: вопрос доходит до конца', async () => {
    await post()
    const config = JSON.parse(sentForm().get('session') as string)
    // Иначе вздох или щелчок на середине вопроса обрывают его, и кандидат
    // не слышит, о чём спросили.
    expect(config.audio.input.turn_detection.interrupt_response).toBe(false)
    expect(config.audio.input.turn_detection.eagerness).toBe('low')
  })

  it('язык распознавания задан жёстко', async () => {
    await post()
    const config = JSON.parse(sentForm().get('session') as string)
    expect(config.audio.input.transcription.language).toBe('en')
  })
})
