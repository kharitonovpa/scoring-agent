'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isEndInterviewCall, readQuestionStarted } from '@/lib/agent-signals'
import { connectRealtime } from '@/lib/realtime-client'
import { loadRole } from '@/lib/roles'
import { InterviewRecorder } from '@/lib/recorder'
import { assembleTurns, computeAudioOffset, type StampedEvent } from '@/lib/turns'
import type { Turn } from '@/lib/types'

export type Phase = 'idle' | 'connecting' | 'live' | 'ending' | 'done' | 'error'

const FLUSH_MS = 4000

/**
 * Потолок считается от заявленной длительности, а не задан числом: с восемью вопросами
 * фиксированные пятнадцать минут обрезали бы разговор на середине. Двойной запас — потому
 * что задача потолка не уложить интервью в срок, а не дать забытой вкладке жечь квоту.
 */
const MAX_INTERVIEW_MS = loadRole('unimatch-default').minutes * 2 * 60 * 1000

/**
 * Обратного отсчёта на экране намеренно нет: мы обещали не считать паузу негативным
 * сигналом, а тикающие часы заставляют человека торопиться и обрывать ответ — то есть
 * портят те самые данные, которые мы собираем. Индикатор вопросов отвечает «сколько
 * осталось» лучше, структурой разговора.
 *
 * Но молча обрывать разговор нельзя: для кандидата это выглядит как сбой по его вине.
 * За четверть потолка до конца показываем спокойное предупреждение.
 */
const WARN_BEFORE_MS = MAX_INTERVIEW_MS * 0.25

// Событие о конце генерации приходит раньше, чем доиграет уже отправленный звук. Рвать
// соединение сразу — значит обрубить агенту прощание на полуслове.
const FAREWELL_GRACE_MS = 2500

export function useInterview() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [nearingLimit, setNearingLimit] = useState(false)
  const [ranOutOfTime, setRanOutOfTime] = useState(false)
  const [questionId, setQuestionId] = useState<string | null>(null)

  const events = useRef<StampedEvent[]>([])
  const pc = useRef<RTCPeerConnection | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const recorder = useRef<InterviewRecorder | null>(null)
  const recordingStartSec = useRef<number | null>(null)
  const startedAt = useRef(0)
  const flusher = useRef<ReturnType<typeof setInterval> | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warning = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRef = useRef<string | null>(null)
  const ended = useRef(false)
  const closing = useRef(false)

  const audioOffset = useCallback(
    () =>
      recordingStartSec.current === null
        ? null
        : computeAudioOffset(events.current, recordingStartSec.current),
    [],
  )

  /**
   * Глушим дорожку, а не останавливаем её: остановленную не вернуть без нового
   * getUserMedia и пересогласования соединения. С `enabled = false` в эфир и в запись
   * идёт тишина, а разговор продолжает жить.
   */
  const toggleMute = useCallback(() => {
    const tracks = mic.current?.getAudioTracks() ?? []
    if (!tracks.length) return
    setMuted((was) => {
      const next = !was
      tracks.forEach((t) => (t.enabled = !next))
      return next
    })
  }, [])

  const persist = useCallback(
    async (done: boolean, status?: 'interrupted', viaBeacon = false) => {
      const id = sessionRef.current
      if (!id) return
      const body = JSON.stringify({
        sessionId: id,
        turns: assembleTurns(events.current),
        audioOffsetSec: audioOffset(),
        done,
        status,
      })
      // sendBeacon — только для закрывающейся вкладки: он не даёт дождаться ответа,
      // а при обычном завершении нам нужно, чтобы сервер успел принять транскрипт
      // до того, как он же запустит анализ.
      if (viaBeacon && 'sendBeacon' in navigator) {
        navigator.sendBeacon('/api/turns', new Blob([body], { type: 'application/json' }))
        return
      }
      await fetch('/api/turns', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      })
    },
    [audioOffset],
  )

  const end = useCallback(
    async (status?: 'interrupted') => {
      if (ended.current) return
      ended.current = true
      setPhase('ending')

      if (flusher.current) clearInterval(flusher.current)
      if (deadline.current) clearTimeout(deadline.current)
      if (warning.current) clearTimeout(warning.current)
      pc.current?.close()
      mic.current?.getTracks().forEach((t) => t.stop())

      // Сначала дожидаемся загрузки записи, потом отдаём транскрипт: анализ на сервере
      // запускается этим же запросом, и к моменту готовности карточки аудио уже на месте.
      await recorder.current?.stop()
      await persist(true, status)
      setPhase('done')
    },
    [persist],
  )

  const start = useCallback(
    async (candidateName: string) => {
      setPhase('connecting')
      setError(null)
      try {
        const res = await fetch('/api/session', {
          method: 'POST',
          body: JSON.stringify({ candidateName }),
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not start the interview')

        sessionRef.current = data.sessionId
        setSessionId(data.sessionId)

        // Подавление шума включаем явно: по умолчанию браузеры ведут себя по-разному, а
        // чувствительный микрофон превращает шорохи и дыхание в отдельные реплики, на
        // которых агент теряет вопрос.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
        })
        mic.current = stream

        recorder.current = new InterviewRecorder(data.sessionId)
        startedAt.current = performance.now()

        const conn = await connectRealtime({
          sessionId: data.sessionId,
          mic: stream,
          onEvent: (event) => {
            events.current.push({
              clientTimeSec: (performance.now() - startedAt.current) / 1000,
              event,
            })
            setTurns(assembleTurns(events.current))

            // Прогресс сообщает агент: он один знает, к какому вопросу перешёл.
            const started = readQuestionStarted(event)
            if (started) setQuestionId(started)

            // Агент отработал все вопросы и попрощался — закрываем разговор за него,
            // дав прощанию доиграть. Кандидат не должен гадать, кончилось ли интервью.
            if (isEndInterviewCall(event)) closing.current = true
            if (closing.current && event.type === 'response.done') {
              closing.current = false
              setTimeout(() => void end(), FAREWELL_GRACE_MS)
            }
          },
          onRemoteStream: (remote) => {
            // ontrack может сработать больше одного раза: второй рекордер на том же
            // потоке нам не нужен.
            if (recordingStartSec.current !== null) return

            const el = new Audio()
            el.autoplay = true
            el.srcObject = remote
            void el.play().catch(() => {})

            const startedRecordingAt = recorder.current!.start(stream, remote)
            recordingStartSec.current = (startedRecordingAt - startedAt.current) / 1000
          },
        })
        pc.current = conn.pc

        conn.pc.onconnectionstatechange = () => {
          if (
            ['failed', 'closed', 'disconnected'].includes(conn.pc.connectionState) &&
            !ended.current
          ) {
            void end('interrupted')
          }
        }

        flusher.current = setInterval(() => void persist(false), FLUSH_MS)
        warning.current = setTimeout(() => setNearingLimit(true), MAX_INTERVIEW_MS - WARN_BEFORE_MS)
        // Забытая открытая вкладка не должна жечь квоту: разговор всё равно закончится.
        deadline.current = setTimeout(() => {
          setRanOutOfTime(true)
          void end()
        }, MAX_INTERVIEW_MS)
        setPhase('live')
      } catch (err) {
        setError((err as Error).message)
        setPhase('error')
      }
    },
    [end, persist],
  )

  useEffect(() => {
    const onUnload = () => {
      if (sessionRef.current && !ended.current) void persist(true, 'interrupted', true)
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [persist])

  return {
    phase,
    error,
    turns,
    sessionId,
    muted,
    questionId,
    nearingLimit,
    ranOutOfTime,
    toggleMute,
    start,
    end,
  }
}
