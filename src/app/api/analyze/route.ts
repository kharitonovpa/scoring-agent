import { runAnalysis } from '@/lib/analyze/run'
import { prepareAudio } from '@/lib/audio/prepare'
import { getSession } from '@/lib/db'

export const maxDuration = 300

/**
 * Обычно запись готовит /api/turns вместе с завершением разговора. Но если тот запрос не
 * дошёл — вкладка упала, ноутбук закрыли, — карточку собирает уже этот роут, и без этого
 * разговор остался бы без записи навсегда, хотя все куски лежат в хранилище. Прогоняем
 * только когда записи ещё нет: ремукс двадцати минут разговора зря не делается.
 */
async function ensureAudio(sessionId: string) {
  const session = await getSession(sessionId)
  if (!session || session.audioUrl || session.audioChunks.length === 0) return
  try {
    await prepareAudio(sessionId)
  } catch (err) {
    // Без записи карточка всё ещё полезна: цитаты останутся текстовыми.
    console.error('audio prepare during analysis failed', sessionId, err)
  }
}

export async function POST(req: Request) {
  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).sessionId
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  try {
    await ensureAudio(sessionId)
    const { droppedClaims } = await runAnalysis(sessionId)
    return Response.json({ ok: true, droppedClaims })
  } catch (err) {
    const message = (err as Error).message
    console.error('analysis failed', sessionId, err)
    if (/^Unknown session/.test(message)) return Response.json({ error: message }, { status: 404 })
    if (/nothing to analyse/.test(message)) return Response.json({ error: message }, { status: 400 })
    return Response.json({ error: 'Analysis failed. You can retry it from the card.' }, { status: 500 })
  }
}
