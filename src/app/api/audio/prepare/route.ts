import { prepareAudio } from '@/lib/audio/prepare'

export const maxDuration = 300

/** Нужен, чтобы починить аудио на существующей сессии, не переигрывая интервью. */
export async function POST(req: Request) {
  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).sessionId
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  try {
    const { audioUrl } = await prepareAudio(sessionId)
    if (!audioUrl) {
      return Response.json({ error: 'No audio recorded for this session' }, { status: 404 })
    }
    return Response.json({ audioUrl })
  } catch (err) {
    const message = (err as Error).message
    console.error('audio prepare failed', sessionId, err)
    if (/^Unknown session/.test(message)) return Response.json({ error: message }, { status: 404 })
    return Response.json({ error: 'Could not prepare the recording.' }, { status: 500 })
  }
}
