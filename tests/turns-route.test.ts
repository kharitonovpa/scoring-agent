import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveTurns = vi.fn(async () => {})
const finishSession = vi.fn(async () => {})
const getSession = vi.fn(async () => ({ id: 's1', status: 'live' }))
const runAnalysis = vi.fn(async () => ({ droppedClaims: 0 }))
const prepareAudio = vi.fn(async () => ({ audioUrl: 'https://blob/seekable.webm' }))

vi.mock('@/lib/db', () => ({ saveTurns, finishSession, getSession }))
vi.mock('@/lib/analyze/run', () => ({ runAnalysis }))
vi.mock('@/lib/audio/prepare', () => ({ prepareAudio }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/turns/route')
  return POST(new Request('http://x/api/turns', { method: 'POST', body: JSON.stringify(body) }))
}

const turn = {
  id: 't1',
  speaker: 'candidate',
  text: 'hi',
  tStart: 1,
  tEnd: 2,
  timingSource: 'server',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 's1', status: 'live' })
})

describe('POST /api/turns', () => {
  it('сохраняет реплики', async () => {
    const res = await post({ sessionId: 's1', turns: [turn] })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ saved: 1 })
    expect(saveTurns).toHaveBeenCalledWith('s1', [turn], null, false)
    expect(finishSession).not.toHaveBeenCalled()
  })

  it('сохраняет калибровку записи, когда клиент её прислал', async () => {
    await post({ sessionId: 's1', turns: [turn], audioOffsetSec: 1.25 })
    expect(saveTurns).toHaveBeenCalledWith('s1', [turn], 1.25, false)
  })

  it('запоминает, что кандидат пользовался рацией', async () => {
    await post({ sessionId: 's1', turns: [turn], usedPushToTalk: true })
    expect(saveTurns).toHaveBeenCalledWith('s1', [turn], null, true)
  })

  it('закрывает сессию и сам запускает анализ при done', async () => {
    await post({ sessionId: 's1', turns: [turn], done: true })
    expect(finishSession).toHaveBeenCalledWith('s1', 'analyzing')
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('прерванную сессию помечает и всё равно анализирует', async () => {
    await post({ sessionId: 's1', turns: [turn], done: true, status: 'interrupted' })
    expect(finishSession).toHaveBeenCalledWith('s1', 'interrupted')
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('готовит аудио раньше анализа, чтобы цитаты были кликабельны сразу', async () => {
    await post({ sessionId: 's1', turns: [turn], done: true })
    expect(prepareAudio).toHaveBeenCalledWith('s1')
    expect(prepareAudio.mock.invocationCallOrder[0]).toBeLessThan(
      runAnalysis.mock.invocationCallOrder[0],
    )
  })

  it('падение анализа не ломает сохранение реплик', async () => {
    runAnalysis.mockRejectedValueOnce(new Error('model exploded') as never)
    const res = await post({ sessionId: 's1', turns: [turn], done: true })
    expect(res.status).toBe(200)
  })

  it('падение подготовки аудио не отменяет анализ', async () => {
    prepareAudio.mockRejectedValueOnce(new Error('blob down') as never)
    const res = await post({ sessionId: 's1', turns: [turn], done: true })
    expect(res.status).toBe(200)
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('404 на неизвестной сессии', async () => {
    getSession.mockResolvedValueOnce(null as never)
    expect((await post({ sessionId: 'nope', turns: [] })).status).toBe(404)
  })

  it('400 на мусорных репликах', async () => {
    expect((await post({ sessionId: 's1', turns: [{ id: 'x' }] })).status).toBe(400)
  })
})
