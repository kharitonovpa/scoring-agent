'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  farewellRequest,
  isEndInterviewCall,
  readQuestionStarted,
  readSpeechState,
} from '@/lib/agent-signals'
import { connectRealtime } from '@/lib/realtime-client'
import { loadRole } from '@/lib/roles'
import { InterviewRecorder } from '@/lib/recorder'
import { affectsTurns, assembleTurns, computeAudioOffset, type StampedEvent } from '@/lib/turns'
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
 * Поэтому в момент, когда агента просят сворачиваться, кандидат видит спокойную плашку.
 */

/**
 * Когда просим агента свернуть разговор. Раньше жёсткого потолка с большим запасом: у него
 * должно остаться время договорить по-человечески, а обрыв соединения остаётся крайней
 * мерой на случай, если агент почему-то не послушался.
 */
const WRAP_UP_MS = loadRole('unimatch-default').minutes * 1.3 * 60 * 1000

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
  const wrapUp = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendToAgent = useRef<((m: unknown) => boolean) | null>(null)
  const candidateSpeaking = useRef(false)
  const farewellPending = useRef(false)
  const farewellSent = useRef(false)
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

  /**
   * Просим агента закончить разговор. Если кандидат говорит прямо сейчас — ждём, пока он
   * замолчит: влезть с прощанием в середину фразы хуже, чем закончить на минуту позже.
   * Если молчит — прощаемся сразу, тянуть незачем.
   */
  const askToWrapUp = useCallback(() => {
    if (farewellSent.current || ended.current) return
    if (candidateSpeaking.current) {
      farewellPending.current = true
      return
    }
    farewellPending.current = false
    farewellSent.current = sendToAgent.current?.(farewellRequest()) ?? false
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
      if (wrapUp.current) clearTimeout(wrapUp.current)
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
            // Храним только то, что нужно доказательной базе. Поток целиком — это тысячи
            // потоковых delta за разговор, и удерживать их незачем: транскрипт и калибровку
            // строят четыре типа событий, остальное мёртвый груз в памяти вкладки.
            if (affectsTurns(event)) {
              events.current.push({
                clientTimeSec: (performance.now() - startedAt.current) / 1000,
                event,
              })
            }
            if (affectsTurns(event)) setTurns(assembleTurns(events.current))

            // Прогресс сообщает агент: он один знает, к какому вопросу перешёл.
            const started = readQuestionStarted(event)
            if (started) setQuestionId(started)

            const speech = readSpeechState(event)
            if (speech) {
              candidateSpeaking.current = speech === 'started'
              // Кандидат договорил — теперь прощание никого не перебьёт.
              if (speech === 'stopped' && farewellPending.current) askToWrapUp()
            }

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
        sendToAgent.current = conn.send

        conn.pc.onconnectionstatechange = () => {
          if (
            ['failed', 'closed', 'disconnected'].includes(conn.pc.connectionState) &&
            !ended.current
          ) {
            void end('interrupted')
          }
        }

        flusher.current = setInterval(() => void persist(false), FLUSH_MS)
        warning.current = setTimeout(() => setNearingLimit(true), WRAP_UP_MS)
        wrapUp.current = setTimeout(askToWrapUp, WRAP_UP_MS)
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
    [askToWrapUp, end, persist],
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
