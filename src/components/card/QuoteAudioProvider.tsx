'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

type State = 'idle' | 'loading' | 'ready' | 'failed'

type QuoteAudio = {
  state: State
  /** Играет диапазон записи в секундах. Возвращает функцию остановки. */
  play: (fromSec: number, toSec: number) => Promise<() => void>
  available: boolean
}

const QuoteAudioContext = createContext<QuoteAudio | null>(null)

// Речи 16 кГц хватает с избытком, а памяти на десятиминутную запись уходит втрое меньше,
// чем на 48 кГц: 38 МБ вместо 115.
const SPEECH_SAMPLE_RATE = 16_000

export function QuoteAudioProvider({
  audioUrl,
  children,
}: {
  audioUrl: string | null
  children: React.ReactNode
}) {
  const [state, setState] = useState<State>('idle')
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<Promise<AudioBuffer> | null>(null)
  const playingRef = useRef<AudioBufferSourceNode | null>(null)

  const load = useCallback(async () => {
    if (!audioUrl) throw new Error('no recording')
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE })
      } catch {
        // Не всякий браузер принимает произвольную частоту — тогда берём его собственную.
        ctxRef.current = new AudioContext()
      }
    }
    if (!bufferRef.current) {
      setState('loading')
      bufferRef.current = fetch(audioUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`recording fetch failed: ${res.status}`)
          return res.arrayBuffer()
        })
        .then((bytes) => ctxRef.current!.decodeAudioData(bytes))
        .then((buffer) => {
          setState('ready')
          return buffer
        })
        .catch((err) => {
          setState('failed')
          bufferRef.current = null
          throw err
        })
    }
    return bufferRef.current
  }, [audioUrl])

  const play = useCallback(
    async (fromSec: number, toSec: number) => {
      const buffer = await load()
      const ctx = ctxRef.current!
      await ctx.resume()

      // Рекрутер сравнивает цитаты подряд, и без этого два фрагмента звучали бы разом —
      // разобрать нельзя ни один.
      playingRef.current?.stop()
      const source = ctx.createBufferSource()
      playingRef.current = source
      source.buffer = buffer
      source.connect(ctx.destination)
      const from = Math.max(0, Math.min(fromSec, buffer.duration))
      const duration = Math.max(0, Math.min(toSec, buffer.duration) - from)
      source.onended = () => {
        if (playingRef.current === source) playingRef.current = null
      }
      source.start(0, from, duration)
      return () => source.stop()
    },
    [load],
  )

  return (
    <QuoteAudioContext.Provider value={{ state, play, available: !!audioUrl }}>
      {children}
    </QuoteAudioContext.Provider>
  )
}

export function useQuoteAudio() {
  const ctx = useContext(QuoteAudioContext)
  if (!ctx) throw new Error('useQuoteAudio must be used inside QuoteAudioProvider')
  return ctx
}
