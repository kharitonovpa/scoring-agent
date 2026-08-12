import { runAnalysis } from '@/lib/analyze/run'
import { prepareAudio } from '@/lib/audio/prepare'
import { finishSession, getSession, saveTurns } from '@/lib/db'
import type { Turn } from '@/lib/types'

// Анализ идёт внутри этого же запроса: на Vercel потолок 300 секунд на всех тарифах,
// анализ укладывается с большим запасом. Клиент анализ не дёргает — иначе закрытая
// вкладка осталась бы без карточки.
export const maxDuration = 300

function isTurn(v: unknown): v is Turn {
  const t = v as Turn
  return (
    !!t &&
    typeof t.id === 'string' &&
    (t.speaker === 'agent' || t.speaker === 'candidate') &&
    typeof t.text === 'string' &&
    typeof t.tStart === 'number' &&
    typeof t.tEnd === 'number' &&
    (t.timingSource === 'server' || t.timingSource === 'client')
  )
}

export async function POST(req: Request) {
  let payload: {
    sessionId?: string
    turns?: unknown
    done?: boolean
    status?: string
    audioOffsetSec?: number | null
  }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const { sessionId } = payload
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })
  if (!Array.isArray(payload.turns) || !payload.turns.every(isTurn)) {
    return Response.json({ error: 'turns must be an array of turns' }, { status: 400 })
  }

  if (!(await getSession(sessionId))) {
    return Response.json({ error: 'Unknown session' }, { status: 404 })
  }

  const turns = payload.turns as Turn[]
  const audioOffsetSec = typeof payload.audioOffsetSec === 'number' ? payload.audioOffsetSec : null
  await saveTurns(sessionId, turns, audioOffsetSec)

  if (!payload.done) return Response.json({ saved: turns.length })

  await finishSession(sessionId, payload.status === 'interrupted' ? 'interrupted' : 'analyzing')

  // Аудио готовим до анализа: к моменту, когда карточка станет доступна, цитаты уже
  // должны быть кликабельны. Обе операции идут в одном окне 300 секунд с запасом.
  try {
    await prepareAudio(sessionId)
  } catch (err) {
    // Без аудио карточка всё ещё полезна: цитаты останутся текстовыми.
    console.error('audio prepare failed', sessionId, err)
  }

  try {
    await runAnalysis(sessionId)
  } catch (err) {
    // Реплики уже сохранены, статус проставлен внутри runAnalysis. Ронять запрос нельзя:
    // клиента может уже не быть, а транскрипт терять из-за упавшего анализа глупо.
    console.error('analysis after interview failed', sessionId, err)
  }
  return Response.json({ saved: turns.length })
}
