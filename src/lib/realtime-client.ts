export async function connectRealtime(opts: {
  sessionId: string
  mic: MediaStream
  onEvent: (event: Record<string, unknown>) => void
  onRemoteStream: (stream: MediaStream) => void
}) {
  const pc = new RTCPeerConnection()
  pc.ontrack = (e) => opts.onRemoteStream(e.streams[0])
  for (const track of opts.mic.getTracks()) pc.addTrack(track, opts.mic)

  const channel = pc.createDataChannel('oai-events')
  channel.onmessage = (e) => {
    try {
      opts.onEvent(JSON.parse(e.data))
    } catch {
      // нечитаемое сообщение канала не должно ронять разговор
    }
  }

  // Модель отвечает, когда кандидат замолчал. Без этого толчка при подключении
  // никто не начинает говорить, и кандидат слушает тишину.
  channel.onopen = () => channel.send(JSON.stringify({ type: 'response.create' }))

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // Рукопожатие идёт через наш сервер: ключа в браузере нет вообще, а запрос к OpenAI
  // уходит из региона развёртывания. См. src/app/api/realtime/call/route.ts.
  const res = await fetch(`/api/realtime/call?sessionId=${encodeURIComponent(opts.sessionId)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: { 'Content-Type': 'application/sdp' },
  })
  if (!res.ok) {
    pc.close()
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Realtime handshake failed: ${res.status}`)
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })

  // Отправка наружу нужна, чтобы попросить агента свернуть разговор. Канал может быть
  // ещё не открыт или уже закрыт — молча пропускаем, ронять интервью из-за этого нельзя.
  const send = (message: unknown) => {
    if (channel.readyState !== 'open') return false
    channel.send(JSON.stringify(message))
    return true
  }

  return { pc, send, callId: res.headers.get('X-Call-Id') || null }
}
