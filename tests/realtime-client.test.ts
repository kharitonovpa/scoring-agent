import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRealtime } from '@/lib/realtime-client'

let channel: {
  onmessage: ((e: MessageEvent) => void) | null
  onopen: ((e: Event) => void) | null
  send: ReturnType<typeof vi.fn>
}
let pcInstance: Record<string, unknown>

beforeEach(() => {
  channel = { onmessage: null, onopen: null, send: vi.fn() }
  pcInstance = {
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER_SDP' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addTrack: vi.fn(),
    close: vi.fn(),
  }
  vi.stubGlobal(
    'RTCPeerConnection',
    vi.fn(() => pcInstance),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('ANSWER_SDP', { status: 200, headers: { 'X-Call-Id': 'rtc_42' } }),
    ),
  )
})

const mic = { getTracks: () => [{ kind: 'audio' }] } as unknown as MediaStream
const connect = (sessionId = 's1') =>
  connectRealtime({ sessionId, mic, onEvent: vi.fn(), onRemoteStream: vi.fn() })

describe('connectRealtime', () => {
  it('шлёт SDP на свой сервер, а не в OpenAI, и не несёт никакого ключа', async () => {
    const { callId } = await connect()

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/realtime/call?sessionId=s1')
    expect(init.body).toBe('OFFER_SDP')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/sdp')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(pcInstance.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(callId).toBe('rtc_42')
  })

  it('прокидывает разобранные события наружу', async () => {
    const onEvent = vi.fn()
    await connectRealtime({ sessionId: 's1', mic, onEvent, onRemoteStream: vi.fn() })
    channel.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) } as MessageEvent)
    expect(onEvent).toHaveBeenCalledWith({ type: 'session.updated' })
  })

  it('не падает на нечитаемом сообщении канала', async () => {
    const onEvent = vi.fn()
    await connectRealtime({ sessionId: 's1', mic, onEvent, onRemoteStream: vi.fn() })
    expect(() => channel.onmessage?.({ data: 'not json' } as MessageEvent)).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('просит агента заговорить первым, как только канал открылся', async () => {
    await connect()
    channel.onopen?.(new Event('open'))
    expect(channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'response.create' }))
  })

  it('показывает сообщение сервера и закрывает соединение, когда handshake не удался', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'OpenAI does not serve the region' }), {
            status: 502,
          }),
      ),
    )
    await expect(connect()).rejects.toThrow(/region/)
    expect(pcInstance.close).toHaveBeenCalled()
  })
})
