'use client'
import { useEffect, useRef, useState } from 'react'

export function MicCheck({
  onReady,
  onError,
}: {
  onReady: () => void
  onError: (m: string) => void
}) {
  const [level, setLevel] = useState(0)
  const [granted, setGranted] = useState(false)
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => {
    let raf = 0
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s
        setGranted(true)
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(peak / 128)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() =>
        onError(
          'We could not reach your microphone. Allow microphone access in your browser, then reload this page.',
        ),
      )

    cleanup.current = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
    return () => cleanup.current()
  }, [onError])

  return (
    <section className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Microphone check</h1>
      <p className="text-neutral-600">Say a few words. The bar should move while you speak.</p>
      <div className="h-3 w-full overflow-hidden rounded bg-neutral-200">
        <div
          className="h-full bg-black transition-[width]"
          style={{ width: `${Math.min(100, level * 160)}%` }}
        />
      </div>
      <button
        disabled={!granted}
        onClick={() => {
          cleanup.current()
          onReady()
        }}
        className="rounded bg-black px-5 py-2.5 text-white disabled:opacity-40"
      >
        I can be heard — start the interview
      </button>
    </section>
  )
}
