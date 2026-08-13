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

    // Вызывается дважды: по кнопке и при размонтировании. Повторное закрытие
    // AudioContext бросает InvalidStateError, поэтому уборка идемпотентна.
    cleanup.current = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      if (ctx && ctx.state !== 'closed') void ctx.close()
      ctx = null
      stream = null
    }
    return () => cleanup.current()
  }, [onError])

  return (
    <section className="mx-auto max-w-xl px-5 py-12 sm:px-6">
      <h1 className="text-[1.75rem] font-semibold tracking-tight">Microphone check</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">Say a few words. The bar should move while you speak.</p>
      <div className="mt-8 h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-75"
          style={{ width: `${Math.min(100, level * 160)}%` }}
        />
      </div>
      <button
        disabled={!granted}
        onClick={() => {
          cleanup.current()
          onReady()
        }}
        className="btn btn-primary mt-8 w-full"
      >
        I can be heard — start the interview
      </button>
    </section>
  )
}
