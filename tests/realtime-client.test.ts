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
        new Response('ANSWER_SDP', {
          status: 200,
          headers: { Location: '/v1/realtime/calls/rtc_42' },
        }),
    ),
  )
})

const mic = { getTracks: () => [{ kind: 'audio' }] } as unknown as MediaStream

describe('connectRealtime', () => {
  it('шлёт SDP на /v1/realtime/calls с эфемерным ключом и открывает канал oai-events', async () => {
    const { callId } = await connectRealtime({
      clientSecret: 'ek_1',
      mic,
      onEvent: vi.fn(),
      onRemoteStream: vi.fn(),
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/realtime/calls')
    expect(init.body).toBe('OFFER_SDP')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ek_1')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/sdp')
    expect(pcInstance.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(callId).toBe('rtc_42')
  })

  it('прокидывает разобранные события наружу', async () => {
    const onEvent = vi.fn()
    await connectRealtime({ clientSecret: 'ek_1', mic, onEvent, onRemoteStream: vi.fn() })
    channel.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) } as MessageEvent)
    expect(onEvent).toHaveBeenCalledWith({ type: 'session.updated' })
  })

  it('не падает на нечитаемом сообщении канала', async () => {
    const onEvent = vi.fn()
    await connectRealtime({ clientSecret: 'ek_1', mic, onEvent, onRemoteStream: vi.fn() })
    expect(() => channel.onmessage?.({ data: 'not json' } as MessageEvent)).not.toThrow()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('просит агента заговорить первым, как только канал открылся', async () => {
    await connectRealtime({ clientSecret: 'ek_1', mic, onEvent: vi.fn(), onRemoteStream: vi.fn() })
    channel.onopen?.(new Event('open'))
    expect(channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'response.create' }))
  })

  it('бросает понятную ошибку и закрывает соединение, когда handshake не удался', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      connectRealtime({ clientSecret: 'ek_bad', mic, onEvent: vi.fn(), onRemoteStream: vi.fn() }),
    ).rejects.toThrow(/401/)
    expect(pcInstance.close).toHaveBeenCalled()
  })
})
