const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export async function connectRealtime(opts: {
  clientSecret: string
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

  const res = await fetch(CALLS_URL, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${opts.clientSecret}`, 'Content-Type': 'application/sdp' },
  })
  if (!res.ok) {
    pc.close()
    throw new Error(`Realtime handshake failed: ${res.status} ${await res.text()}`)
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  return { pc, callId: res.headers.get('Location')?.split('/').pop() ?? null }
}
