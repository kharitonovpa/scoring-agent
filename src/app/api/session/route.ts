import { countSessionsSince, createSession } from '@/lib/db'
import { buildInstructions, loadRole } from '@/lib/roles'

const DEFAULT_ROLE = 'unimatch-default'
const MAX_SESSIONS_PER_HOUR = 30

export async function POST(req: Request) {
  let payload: { candidateName?: string; roleId?: string }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const candidateName = (payload.candidateName ?? '').trim()
  if (!candidateName) {
    return Response.json({ error: 'Candidate name is required' }, { status: 400 })
  }

  const roleId = payload.roleId ?? DEFAULT_ROLE
  let role
  try {
    role = loadRole(roleId)
  } catch {
    return Response.json({ error: `Unknown role: ${roleId}` }, { status: 400 })
  }

  // Демо-ссылка публичная, а квота одна: лучше честный отказ здесь, чем сгоревшая
  // квота посреди чужого интервью.
  const recent = await countSessionsSince(new Date(Date.now() - 60 * 60 * 1000))
  if (recent >= MAX_SESSIONS_PER_HOUR) {
    return Response.json(
      { error: 'This demo has hit its hourly interview limit. Please try again in an hour.' },
      { status: 429 },
    )
  }

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: `${buildInstructions(role)}\n\nThe candidate's name is ${candidateName}.`,
        audio: {
          input: {
            transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: { type: 'semantic_vad', eagerness: 'low' },
          },
          output: { voice: 'marin' },
        },
        reasoning: { effort: 'low' },
      },
    }),
  })

  if (!res.ok) {
    console.error('client_secrets failed', res.status, await res.text())
    return Response.json(
      { error: 'OpenAI is not accepting calls right now. Please try again in a minute.' },
      { status: 502 },
    )
  }

  const secret = (await res.json()) as { value?: string }
  if (!secret.value) {
    return Response.json({ error: 'OpenAI returned no client secret' }, { status: 502 })
  }

  // Ключ запрашивается до создания строки сессии: если у OpenAI кончилась квота,
  // мы не оставляем в дашборде мусорную сессию, которая никогда не начнётся.
  const sessionId = await createSession({ candidateName, roleId })
  return Response.json({ sessionId, clientSecret: secret.value })
}
