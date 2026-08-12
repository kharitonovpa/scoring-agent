import { upload } from '@vercel/blob/client'

const CHUNK_MS = 15_000
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Микрофон и трек агента идут в один выход: писать только микрофон значит потерять голос агента. */
export function mixStreams(ctx: AudioContext, streams: MediaStream[]): MediaStream {
  const destination = ctx.createMediaStreamDestination()
  for (const stream of streams) ctx.createMediaStreamSource(stream).connect(destination)
  return destination.stream
}

/**
 * Единственная строка типа, работающая во всех браузерах. По умолчанию её не ставит
 * никто, кроме Chrome: Firefox отдаёт ogg, Safari — mp4, поэтому задаём явно.
 */
export function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export class InterviewRecorder {
  private recorder: MediaRecorder | null = null
  private ctx: AudioContext | null = null
  private index = 0
  private pending: Promise<unknown>[] = []

  constructor(private readonly sessionId: string) {}

  get chunkCount() {
    return this.index
  }

  /** Возвращает момент старта записи по часам клиента — он нужен для калибровки таймингов. */
  start(mic: MediaStream, remote: MediaStream): number {
    this.ctx = new AudioContext()
    const mixed = mixStreams(this.ctx, [mic, remote])
    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.pending.push(this.put(e.data))
    }
    const startedAt = performance.now()
    this.recorder.start(CHUNK_MS)
    return startedAt
  }

  private async put(data: Blob) {
    if (data.size > MAX_UPLOAD_BYTES) {
      console.error('recording chunk too large to upload', data.size)
      return
    }
    const name = String(this.index++).padStart(4, '0')
    try {
      const blob = await upload(`interviews/${this.sessionId}/${name}.webm`, data, {
        access: 'public',
        handleUploadUrl: '/api/blob-token',
        clientPayload: this.sessionId,
        contentType: data.type || 'audio/webm',
      })
      // Регистрируем сами: вебхук onUploadCompleted не работает на localhost,
      // а проверять аудио только на проде — плохой цикл разработки.
      await fetch('/api/audio/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, url: blob.url }),
        keepalive: true,
      })
    } catch (err) {
      // Потеря чанка не должна ронять интервью: разговор важнее записи.
      console.error('audio chunk upload failed', name, err)
    }
  }

  async stop() {
    this.recorder?.stop()
    await Promise.allSettled(this.pending)
    await this.ctx?.close()
    this.recorder = null
    this.ctx = null
  }
}
