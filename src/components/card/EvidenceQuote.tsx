'use client'
import { useEffect, useRef, useState } from 'react'
import type { Evidence, Turn } from '@/lib/types'
import { useQuoteAudio } from './QuoteAudioProvider'

// Подушка по краям сглаживает границы определения речи. prefix_padding_ms уже включён
// в серверный audio_start_ms, поэтому она небольшая.
const PAD = 0.4

export function EvidenceQuote({
  evidence,
  turns,
  audioOffsetSec,
}: {
  evidence: Evidence
  turns: Turn[]
  audioOffsetSec: number | null
}) {
  const { play, available, state } = useQuoteAudio()
  const [playing, setPlaying] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turn = turns.find((t) => t.id === evidence.turnId)

  useEffect(
    () => () => {
      stopRef.current?.()
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // Тайминги реплик живут в шкале аудио сессии OpenAI, а файл начался позже или раньше:
  // без этой поправки фрагмент играет не те слова.
  const offset = audioOffsetSec ?? 0
  const from = turn ? Math.max(0, turn.tStart - offset - PAD) : 0
  const to = turn ? turn.tEnd - offset + PAD : 0
  const playable = available && !!turn && to > from

  async function toggle() {
    if (!playable) return
    if (playing) {
      stopRef.current?.()
      stopRef.current = null
      if (timer.current) clearTimeout(timer.current)
      setPlaying(false)
      return
    }
    try {
      setPlaying(true)
      stopRef.current = await play(from, to)
      // Снимаем подсветку, когда фрагмент доиграл.
      timer.current = setTimeout(() => setPlaying(false), (to - from) * 1000)
    } catch {
      setPlaying(false)
    }
  }

  const hint = !available
    ? 'Запись недоступна'
    : state === 'failed'
      ? 'Запись не удалось загрузить'
      : state === 'loading'
        ? 'Загружаю запись…'
        : 'Прослушать этот фрагмент'

  return (
    <button onClick={toggle} disabled={!playable || state === 'failed'} title={hint} className="quote">
      <span className="quote-play" aria-hidden>
        {playing ? '■' : '▶'}
      </span>
      <span className="text-sm leading-relaxed">
        <span className="text-ink">«{evidence.quote}»</span>
        {turn && (
          <span className="ml-2 whitespace-nowrap text-xs text-ink-faint">
            {playing
              ? 'играет'
              : state === 'loading'
                ? 'загружаю…'
                : `${Math.max(0, turn.tStart - offset).toFixed(1)} с`}
          </span>
        )}
      </span>
    </button>
  )
}
