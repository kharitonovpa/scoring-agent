import { getSession } from '@/lib/db'
import { buildSessionConfig } from '@/lib/realtime-session'

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

/**
 * Обмен SDP идёт через нас, а не напрямую из браузера в OpenAI. Две причины.
 *
 * Первая: постоянный ключ вообще не покидает сервер — в браузере нет никакого ключа,
 * даже короткоживущего, и конфиг разговора клиент подменить не может.
 *
 * Вторая: OpenAI закрывает доступ по географии запроса. Браузер кандидата может стоять
 * в неподдерживаемом регионе; запрос же уходит отсюда, из региона развёртывания. Медиа
 * после рукопожатия идёт напрямую браузер ↔ OpenAI и через нас не проходит.
 */
export async function POST(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId')
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  const session = await getSession(sessionId)
  if (!session) return Response.json({ error: 'Unknown session' }, { status: 404 })

  const offer = await req.text()
  if (!offer.startsWith('v=')) {
    return Response.json({ error: 'Body must be an SDP offer' }, { status: 400 })
  }

  let config: ReturnType<typeof buildSessionConfig>
  try {
    config = buildSessionConfig(session.roleId, session.candidateName)
  } catch {
    return Response.json({ error: `Unknown role: ${session.roleId}` }, { status: 400 })
  }

  const form = new FormData()
  form.set('sdp', offer)
  form.set('session', JSON.stringify(config))

  const res = await fetch(CALLS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error('realtime handshake failed', res.status, detail)
    // Отказ по географии стоит назвать своим именем: иначе его час ищут в ключе и биллинге.
    if (detail.includes('unsupported_country_region_territory')) {
      return Response.json(
        { error: 'OpenAI does not serve the region this app is deployed in.' },
        { status: 502 },
      )
    }
    return Response.json(
      { error: 'OpenAI is not accepting calls right now. Please try again in a minute.' },
      { status: 502 },
    )
  }

  return new Response(await res.text(), {
    headers: {
      'Content-Type': 'application/sdp',
      // Идентификатор звонка нужен клиенту для диагностики, а Location браузеру не виден.
      'X-Call-Id': res.headers.get('Location')?.split('/').pop() ?? '',
    },
  })
}
