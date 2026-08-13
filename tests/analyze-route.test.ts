import { beforeEach, describe, expect, it, vi } from 'vitest'

const runAnalysis = vi.fn(async () => ({ droppedClaims: 0 }))
const prepareAudio = vi.fn(async () => ({ audioUrl: 'https://blob/seekable.webm' }))
const getSession = vi.fn(async () => ({ id: 's1', audioUrl: null, audioChunks: ['a', 'b'] }))

vi.mock('@/lib/analyze/run', () => ({ runAnalysis }))
vi.mock('@/lib/audio/prepare', () => ({ prepareAudio }))
vi.mock('@/lib/db', () => ({ getSession }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/analyze/route')
  return POST(new Request('http://x/api/analyze', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 's1', audioUrl: null, audioChunks: ['a', 'b'] })
})

describe('POST /api/analyze', () => {
  it('анализирует сессию', async () => {
    const res = await post({ sessionId: 's1' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, droppedClaims: 0 })
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('готовит запись, если разговор закончился без неё', async () => {
    await post({ sessionId: 's1' })
    expect(prepareAudio).toHaveBeenCalledWith('s1')
  })

  it('не перегоняет запись, которая уже готова', async () => {
    getSession.mockResolvedValue({
      id: 's1',
      audioUrl: 'https://blob/seekable.webm',
      audioChunks: ['a', 'b'],
    } as never)
    await post({ sessionId: 's1' })
    expect(prepareAudio).not.toHaveBeenCalled()
  })

  it('не трогает запись, когда чанков нет', async () => {
    getSession.mockResolvedValue({ id: 's1', audioUrl: null, audioChunks: [] } as never)
    await post({ sessionId: 's1' })
    expect(prepareAudio).not.toHaveBeenCalled()
  })

  it('падение подготовки записи не отменяет анализ', async () => {
    prepareAudio.mockRejectedValueOnce(new Error('blob down') as never)
    const res = await post({ sessionId: 's1' })
    expect(res.status).toBe(200)
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('400 без sessionId', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('404 на неизвестной сессии', async () => {
    getSession.mockResolvedValue(null as never)
    runAnalysis.mockRejectedValueOnce(new Error('Unknown session: nope') as never)
    expect((await post({ sessionId: 'nope' })).status).toBe(404)
  })
})
