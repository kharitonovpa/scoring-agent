import { put } from '@vercel/blob'
import { ALL_FORMATS, BufferSource, BufferTarget, Conversion, Input, Output, WebMOutputFormat } from 'mediabunny'
import { getSession, setAudioUrl } from '@/lib/db'

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url)
  if (!res.ok) {
    console.error('audio fetch failed', url, res.status)
    return null
  }
  return res.arrayBuffer()
}

/**
 * Склеивает чанки в один поток. Чанки названы номерами с ведущими нулями, поэтому
 * лексикографический порядок совпадает с хронологическим; заголовок лежит в первом,
 * остальные — продолжение того же потока, и конкатенация по порядку даёт разбираемый файл.
 */
async function collectSource(session: { audioChunks: string[] }): Promise<ArrayBuffer | null> {
  const parts: ArrayBuffer[] = []
  for (const url of [...session.audioChunks].sort()) {
    const part = await fetchBytes(url)
    if (part) parts.push(part)
  }
  if (parts.length === 0) return null
  return new Blob(parts).arrayBuffer()
}

/**
 * MediaRecorder пишет поток, а не файл: в его выводе нет ни длительности, ни индекса
 * позиций, поэтому перемотка по нему ненадёжна. Ремукс копированием пакетов, без
 * перекодирования, дописывает и то и другое. Идемпотентна.
 */
export async function prepareAudio(sessionId: string): Promise<{ audioUrl: string | null }> {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`Unknown session: ${sessionId}`)

  const source = await collectSource(session)
  if (!source) return { audioUrl: null }

  const input = new Input({ source: new BufferSource(source), formats: ALL_FORMATS })
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
  try {
    // Ни appendOnly, ни onProgress: первое отключило бы запись длительности и индекса,
    // второе заставило бы лишний раз просканировать файл целиком.
    const conversion = await Conversion.init({ input, output })
    await conversion.execute()
  } finally {
    await input.dispose()
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error('Remux produced no output')

  const blob = await put(
    `interviews/${sessionId}/seekable.webm`,
    new Blob([buffer], { type: 'audio/webm' }),
    { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'audio/webm' },
  )
  await setAudioUrl(sessionId, blob.url)
  return { audioUrl: blob.url }
}
