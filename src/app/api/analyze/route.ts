import { runAnalysis } from '@/lib/analyze/run'

export const maxDuration = 300

export async function POST(req: Request) {
  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).sessionId
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  try {
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
