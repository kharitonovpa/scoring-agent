/**
 * На склейке `audio_start_ms` с `item_id` стоит вся доказательная база карточки: без неё
 * цитата не знает, какому куску записи соответствует. Проверяем это до интерфейса.
 *
 * Речь берём из TTS и подаём в сессию сами, вместо микрофона и живого человека: так
 * проверка воспроизводима и её можно перезапустить после любой правки конфига.
 *
 * Что проверка НЕ покрывает: транспорт здесь WebSocket, а в приложении WebRTC. Схема
 * событий у них общая, но выравнивание с записью MediaRecorder проверяется только живьём.
 *
 * Запуск: npm run probe
 */
import { writeFileSync } from 'node:fs'
import { useProxyIfConfigured } from '../src/lib/proxy.ts'

const KEY = process.env.OPENAI_API_KEY
if (!KEY) {
  console.error('OPENAI_API_KEY не задан')
  process.exit(1)
}

await useProxyIfConfigured((m) => console.log(`· ${m}`))

const SAMPLE_RATE = 24_000
const SPEECH = [
  'At my last job I was the only backend engineer on a payments team.',
  'We had a bug where refunds were silently failing for about two percent of orders.',
]

/** PCM16 моно 24 кГц — формат, который Realtime принимает во входной буфер. */
async function tts(text: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
  })
  if (!res.ok) throw new Error(`TTS failed ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

const silence = (ms: number) => Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * 2)

console.log('Генерирую речь…')
const clips = await Promise.all(SPEECH.map(tts))
clips.forEach((c, i) => console.log(`  фраза ${i + 1}: ${Math.round(c.length / 2 / SAMPLE_RATE * 1000)} мс`))

// Тишина по краям и в середине: без неё VAD не увидит границ реплики.
const segments: { label: string; buf: Buffer }[] = [
  { label: 'тишина', buf: silence(600) },
  { label: 'фраза 1', buf: clips[0] },
  { label: 'пауза', buf: silence(1600) },
  { label: 'фраза 2', buf: clips[1] },
  { label: 'тишина', buf: silence(1800) },
]

// Ожидаемое положение каждой фразы в аудиопотоке — с этим сравним то, что скажет сервер.
let cursor = 0
const expected: { label: string; startMs: number; endMs: number }[] = []
for (const s of segments) {
  const ms = (s.buf.length / 2 / SAMPLE_RATE) * 1000
  if (s.label.startsWith('фраза')) expected.push({ label: s.label, startMs: cursor, endMs: cursor + ms })
  cursor += ms
}

// Без подпротокола openai-beta: бета-форма API отключена, работает только GA.
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', [
  'realtime',
  `openai-insecure-api-key.${KEY}`,
])

const seen: Record<string, unknown>[] = []
const send = (m: unknown) => ws.send(JSON.stringify(m))

ws.onerror = (e) => {
  console.error('WebSocket ошибка:', (e as ErrorEvent).message ?? e)
  process.exit(1)
}

ws.onopen = () => {
  console.log('Соединение открыто, настраиваю сессию…')
  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['text'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          transcription: { model: 'gpt-4o-transcribe' },
          turn_detection: { type: 'semantic_vad', eagerness: 'low' },
        },
      },
    },
  })

  // Куски по 100 мс: примерно так же аудио идёт с живого микрофона.
  const stream = Buffer.concat(segments.map((s) => s.buf))
  const chunk = SAMPLE_RATE * 0.1 * 2
  for (let i = 0; i < stream.length; i += chunk) {
    send({ type: 'input_audio_buffer.append', audio: stream.subarray(i, i + chunk).toString('base64') })
  }
  console.log(`Отправил ${Math.round(stream.length / 2 / SAMPLE_RATE * 1000)} мс аудио, жду события…\n`)
}

ws.onmessage = (e) => {
  const ev = JSON.parse(e.data as string)
  seen.push(ev)
  if (ev.type === 'error') console.error('!! error:', JSON.stringify(ev.error))
}

setTimeout(() => {
  ws.close()
  report()
}, 25_000)

function report() {
  const of = (t: string) => seen.filter((e) => e.type === t)
  const starts = of('input_audio_buffer.speech_started')
  const stops = of('input_audio_buffer.speech_stopped')
  const done = of('conversation.item.input_audio_transcription.completed')

  console.log('=== Типы полученных событий ===')
  for (const [t, n] of Object.entries(
    seen.reduce<Record<string, number>>((a, e) => ({ ...a, [e.type as string]: (a[e.type as string] ?? 0) + 1 }), {}),
  )) console.log(`  ${n}×  ${t}`)

  console.log('\n=== Вопрос 1: несёт ли speech_started миллисекунды ===')
  if (!starts.length) console.log('  ✗ событий speech_started нет вообще')
  for (const s of starts) {
    const has = typeof s.audio_start_ms === 'number'
    console.log(`  ${has ? '✓' : '✗'} audio_start_ms=${s.audio_start_ms} item_id=${s.item_id}`)
  }
  for (const s of stops) {
    const has = typeof s.audio_end_ms === 'number'
    console.log(`  ${has ? '✓' : '✗'} audio_end_ms=${s.audio_end_ms}   item_id=${s.item_id}`)
  }

  console.log('\n=== Вопрос 2: склеиваются ли item_id с транскрипцией ===')
  if (!done.length) console.log('  ✗ завершённых транскрипций нет')
  for (const d of done) {
    const vad = starts.find((s) => s.item_id === d.item_id)
    console.log(`  ${vad ? '✓ склеилось' : '✗ НЕ склеилось'} item_id=${d.item_id}`)
    console.log(`     текст: "${String(d.transcript ?? '').trim()}"`)
    if (vad) {
      const stop = stops.find((s) => s.item_id === d.item_id)
      console.log(`     сервер говорит: ${vad.audio_start_ms}–${stop?.audio_end_ms} мс`)
    }
  }

  console.log('\n=== Вопрос 3: сходится ли с тем, что мы отправили ===')
  expected.forEach((exp, i) => {
    const s = starts[i]
    if (!s) return console.log(`  ${exp.label}: события нет`)
    const drift = Math.round((s.audio_start_ms as number) - exp.startMs)
    console.log(`  ${exp.label}: отправлено с ${Math.round(exp.startMs)} мс, сервер сказал ${s.audio_start_ms} мс → расхождение ${drift} мс`)
  })

  const path = 'docs/realtime-probe-raw.json'
  writeFileSync(path, JSON.stringify({ expected, events: seen }, null, 2))
  console.log(`\nПолный лог событий: ${path}`)
  process.exit(0)
}
