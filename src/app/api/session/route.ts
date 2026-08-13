import { sanitizeCandidateName } from '@/lib/candidate-name'
import { countSessionsSince, createSession } from '@/lib/db'
import { loadRole } from '@/lib/roles'

const DEFAULT_ROLE = 'unimatch-default'
const MAX_SESSIONS_PER_HOUR = 30

export async function POST(req: Request) {
  let payload: { candidateName?: string; roleId?: string }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const candidateName = sanitizeCandidateName(payload.candidateName)
  if (!candidateName) {
    return Response.json({ error: 'Candidate name is required' }, { status: 400 })
  }

  // Роль проверяем здесь, чтобы опечатка в roleId всплыла до начала разговора,
  // а не на рукопожатии.
  const roleId = payload.roleId ?? DEFAULT_ROLE
  try {
    loadRole(roleId)
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

  // Никакого ключа клиенту: соединение с OpenAI устанавливается обменом SDP через
  // /api/realtime/call, и конфиг разговора собирается там же на сервере.
  const sessionId = await createSession({ candidateName, roleId })
  return Response.json({ sessionId })
}
