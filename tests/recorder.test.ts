import { describe, expect, it, vi } from 'vitest'
import { mixStreams, pickMimeType } from '@/lib/recorder'

describe('mixStreams', () => {
  it('подключает каждый входной поток к общему выходу', () => {
    const connect = vi.fn()
    const destination = { stream: { id: 'mixed' } }
    const ctx = {
      createMediaStreamSource: vi.fn(() => ({ connect })),
      createMediaStreamDestination: vi.fn(() => destination),
    } as unknown as AudioContext

    const mic = { id: 'mic' } as MediaStream
    const agent = { id: 'agent' } as MediaStream
    const out = mixStreams(ctx, [mic, agent])

    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledWith(destination)
    expect(out).toBe(destination.stream)
  })
})

describe('pickMimeType', () => {
  it('предпочитает opus в webm', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true })
    expect(pickMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('откатывается на mp4, когда webm не поддержан', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (t: string) => t === 'audio/mp4',
    })
    expect(pickMimeType()).toBe('audio/mp4')
  })

  it('возвращает undefined, когда ничего не поддержано — браузер решит сам', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false })
    expect(pickMimeType()).toBeUndefined()
  })
})
