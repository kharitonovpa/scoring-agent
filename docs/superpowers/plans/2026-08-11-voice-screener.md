# Voice Screener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Голосовой AI-рекрутер: проводит первичный скрининг на английском и отдаёт рекрутеру карточку, где каждое утверждение подкреплено кликабельной цитатой с аудио-фрагментом.

**Architecture:** Next.js 15 на Vercel. Браузер соединяется с OpenAI Realtime напрямую по WebRTC (эфемерный ключ выдаёт серверный роут). Транскрипт и тайминги собираются из событий data channel `oai-events` и инкрементально пишутся в Neon Postgres; аудио пишется `MediaRecorder`-ом из смешанного потока (микрофон + трек агента) и грузится чанками прямо в Vercel Blob. После разговора серверный роут гоняет транскрипт через три параллельных LLM-вызова со строгими схемами, выбрасывает утверждения без подтверждённых цитат и складывает карточку.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind v4) · OpenAI Realtime `gpt-realtime-2.1` (сырой `RTCPeerConnection`, без SDK) · OpenAI structured outputs для анализа · Neon Postgres (`@neondatabase/serverless`) · Vercel Blob (клиентская загрузка) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-11-voice-screener-design.md` — читать до начала работы.

## Global Constraints

- **Язык UI:** кандидатский флоу (`/`, `/interview`) — только английский. Карточка и дашборд (`/card/[id]`, `/dashboard`) — только русский; цитаты внутри карточки остаются на английском как есть.
- **Дедлайн:** сдача четверг 13 августа 2026, 18:00 МСК. Деплой на Vercel — в первый день работы, до того как написан UI.
- **Запреты, зашитые в промпты и проверяемые кодом:** не оценивать акцент, темп речи, пол, возраст; не считать паузу негативным сигналом самой по себе; не начинать интервью без явного согласия на запись.
- **Ключ OpenAI никогда не уходит на клиент.** Браузер получает только эфемерный ключ из `/api/session`.
- **Рубрика оценки не попадает в инструкции разговора** — клиент технически может переопределить конфиг сессии, привязанный к эфемерному ключу. Вся оценка живёт в `/api/analyze`.
- **Утверждение без подтверждённой цитаты в карточку не попадает.** Цитата подтверждена, если её нормализованный текст входит в текст указанной реплики **кандидата**. Это ядро задачи, а не деталь. Требование «минимум одна цитата» проверяется **кодом, а не схемой ответа модели**: схема, обязывающая приложить цитату к каждому полю, вынуждает модель выдумать её там, где сказать нечего.
- **Порог достаточности данных.** Если английской речи кандидата меньше 60 секунд или меньше трёх реплик, блоки оценки показывают «недостаточно данных для оценки» вместо буквы CEFR или вывода. Оценка по сорока секундам — та самая необоснованность, от которой уходит задача.
- **Цифры пауз на карточку не выводятся** — они идут только в анализ как нейтральный контекст. На экране рекрутер видит из числовых характеристик только длительность разговора.
- **Анализ запускается на сервере** роутом `/api/turns` при получении признака «разговор закончен». Клиент его не дёргает: закрытая вкладка и прерванная сессия должны получить карточку так же, как обычная. Страница карточки держит вторую попытку.
- **Мягкий лимит на прогоны:** не больше 30 сессий в час на всё демо и автозавершение разговора на 15-й минуте. Демо-ссылка публичная, квота одна.
- **Structured Outputs, точные значения** (проверено 11.08.2026):
  - `strict: true` задаётся **явно**; если его опустить, Responses API молча переходит в нестрогий режим и гарантии формы теряются
  - под `strict` **все** поля обязаны быть в `required`; необязательное поле выражается union-типом с `null` (`z.string().nullable()`, не `.optional()`)
  - `additionalProperties: false` обязателен на каждом объекте; корень схемы — объект, не union
  - рекомендованный путь SDK: `client.responses.parse()` с `zodTextFormat(schema, name)`, результат читается из `response.output_parsed`
- **Vercel, точные значения** (проверено 11.08.2026):
  - `maxDuration` по умолчанию **300 секунд на всех тарифах**, включая Hobby; на Hobby это же и максимум
  - тело запроса и ответа функции ограничено **4.5 МБ** — аудио грузится в Blob напрямую с клиента, не через функцию
  - файлы, читаемые через `fs` из `process.cwd()`, могут не попасть в бандл; поэтому конфиг роли подключается **статическим импортом**, а не чтением с диска
  - `onUploadCompleted` у Blob **не срабатывает на localhost** — URL загруженного файла регистрирует сам клиент отдельным запросом
  - `put()` с существующим `pathname` по умолчанию **падает**; для перезаписи нужен `allowOverwrite: true`
- **Realtime API, точные значения** (проверено 11.08.2026):
  - эфемерный ключ: `POST https://api.openai.com/v1/realtime/client_secrets`, тело `{ session: {...}, expires_after: { anchor: 'created_at', seconds: 120 } }`, берём `.value`
  - SDP: `POST https://api.openai.com/v1/realtime/calls`, `Content-Type: application/sdp`, `Authorization: Bearer ek_...`, ответ — сырой SDP-текст, **без** `?model=`
  - data channel строго `oai-events`
  - модель `gpt-realtime-2.1`, `reasoning.effort: 'low'`
  - транскрипция входа **по умолчанию выключена**: `session.audio.input.transcription.model = 'gpt-4o-transcribe'`
  - тайминги кандидата: `input_audio_buffer.speech_started.audio_start_ms` и `speech_stopped.audio_end_ms`, склейка с транскрипцией по `item_id`
- **Commit после каждой задачи.** Сообщения на русском, префиксы `feat:` / `test:` / `fix:` / `docs:` / `chore:`.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `config/roles/unimatch-default.json` | Конфиг роли: компания, вопросы, FAQ. Единственное место, где живёт содержание интервью |
| `src/lib/types.ts` | Все типы домена: `Turn`, `Metrics`, `Card`, статусы |
| `src/lib/db.ts` | Neon-клиент и CRUD по сессиям. Никакой логики домена |
| `src/lib/roles.ts` | Загрузка конфига роли и сборка инструкций для агента |
| `src/lib/turns.ts` | Чистая сборка `Turn[]` из событий Realtime. Сердце таймингов |
| `src/lib/metrics.ts` | Чистый расчёт нейтральных метрик из `Turn[]` |
| `src/lib/evidence.ts` | Чистая валидация цитат и отбраковка утверждений |
| `src/lib/analyze/schemas.ts` | JSON-схемы трёх анализов |
| `src/lib/analyze/prompts.ts` | Промпты трёх анализов, включая запреты |
| `src/lib/analyze/index.ts` | Оркестрация: три вызова, валидация, сборка карточки |
| `src/lib/recorder.ts` | Смешанный поток, `MediaRecorder`, загрузка чанков в Blob |
| `src/lib/realtime-client.ts` | WebRTC-соединение и разбор событий в браузере |
| `src/hooks/useInterview.ts` | Состояние интервью: соединение, реплики, запись, завершение |
| `src/app/api/session/route.ts` | Эфемерный ключ + создание строки сессии |
| `src/app/api/turns/route.ts` | Инкрементальная запись реплик |
| `src/app/api/blob-token/route.ts` | Токен клиентской загрузки в Blob |
| `src/app/api/audio/stitch/route.ts` | Склейка чанков в один файл |
| `src/app/api/analyze/route.ts` | Запуск анализа, идемпотентно |
| `src/app/api/sessions/route.ts` | Список сессий для дашборда |
| `src/app/probe/page.tsx` | Одноразовая страница проверки таймингов (задача 2) |
| `src/app/interview/page.tsx` | Кандидатский флоу: согласие → микрофон → разговор → спасибо |
| `src/components/interview/*` | Экраны кандидатского флоу |
| `src/app/card/[id]/page.tsx` | Карточка рекрутера |
| `src/components/card/EvidenceQuote.tsx` | Цитата с воспроизведением фрагмента |
| `src/components/card/*` | Блоки карточки |
| `src/app/dashboard/page.tsx` | Список сессий |

---

### Task 1: Скелет проекта и деплой на Vercel

Деплой идёт первым, до любого UI: по условиям задачи «работает локально» равно «не работает», и узнать это надо в первый день, а не в четверг.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/app/api/health/route.ts`
- Create: `tests/health.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces: работающий Next.js-проект, `npm run dev`, `npm run test`, задеплоенный URL

- [ ] **Step 1: Создать проект**

```bash
cd /Users/pohare/Desktop/unimatch/projects/scoring-agent
npx create-next-app@latest . --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
```

Если `create-next-app` отказывается из-за непустой папки — создать в `.tmp-app` и перенести содержимое, сохранив `docs/`, `CUSTOMER-QUESTIONS.md`, `pavel-voice-screener.md`, `.git`.

- [ ] **Step 2: Перенести приложение в `src/`**

`create-next-app` с `--no-src-dir` кладёт `app/` в корень. Перенести: `mkdir -p src && git mv app src/app`. Проверить, что `tsconfig.json` содержит `"paths": { "@/*": ["./src/*"] }`.

- [ ] **Step 3: Поставить зависимости проекта**

```bash
npm install openai zod @neondatabase/serverless @vercel/blob
npm install -D vitest @vitejs/plugin-react
```

- [ ] **Step 4: Настроить vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

В `package.json` добавить в `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Написать падающий тест health-роута**

`tests/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('health', () => {
  it('отвечает ok', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })
})
```

- [ ] **Step 6: Запустить тест, убедиться что падает**

Run: `npm run test`
Expected: FAIL — не найден модуль `@/app/api/health/route`

- [ ] **Step 7: Реализовать health-роут**

`src/app/api/health/route.ts`:

```ts
export function GET() {
  return Response.json({ ok: true })
}
```

- [ ] **Step 8: Запустить тест, убедиться что проходит**

Run: `npm run test`
Expected: PASS

- [ ] **Step 9: Создать `.env.example`**

```bash
# OpenAI: Realtime для разговора и structured outputs для анализа
OPENAI_API_KEY=sk-...
# Модель анализа транскрипта; значение проверяется в задаче 13
OPENAI_ANALYSIS_MODEL=
# Neon Postgres
DATABASE_URL=postgres://...
# Vercel Blob (подставляется автоматически при связывании стора)
BLOB_READ_WRITE_TOKEN=
# Показывать кандидату ссылку на карточку после интервью (демо)
NEXT_PUBLIC_DEMO_MODE=true
```

- [ ] **Step 10: Завести локальный `.env.local`**

Скопировать `.env.example` в `.env.local` и вписать реальный `OPENAI_API_KEY`. `.env.local` уже в `.gitignore` — проверить, что `git status` его не показывает.

- [ ] **Step 11: Задеплоить на Vercel**

```bash
npx vercel@latest link --yes
npx vercel@latest env add OPENAI_API_KEY production
npx vercel@latest --prod
```

- [ ] **Step 12: Проверить деплой живьём**

```bash
curl -s https://<deployment-url>/api/health
```
Expected: `{"ok":true}`

- [ ] **Step 13: Коммит**

```bash
git add -A
git commit -m "feat: скелет Next.js, health-роут, деплой на Vercel"
```

---

### Task 2: Эмпирическая проверка таймингов Realtime

На склейке `audio_start_ms` с `item_id` стоит вся доказательная база карточки. Если она не работает — меняется дизайн, а не UI. Поэтому проверка идёт до любого интерфейса.

**Files:**
- Create: `src/app/api/probe-token/route.ts`
- Create: `src/app/probe/page.tsx`
- Create: `docs/realtime-probe-findings.md`

**Interfaces:**
- Consumes: `OPENAI_API_KEY` из окружения
- Produces: подтверждённые ответы на два вопроса — приходят ли `audio_start_ms` при `semantic_vad` и совпадают ли `item_id` в VAD-событиях и транскрипции; выбранный тип VAD зафиксирован в `docs/realtime-probe-findings.md`

- [ ] **Step 1: Реализовать роут выдачи эфемерного ключа для проверки**

`src/app/api/probe-token/route.ts`:

```ts
export async function POST() {
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions:
          'You are testing an audio connection. Ask the user three short questions about their day, one at a time. Keep every reply under fifteen words.',
        audio: {
          input: {
            transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: { type: 'semantic_vad', eagerness: 'low' },
          },
          output: { voice: 'marin' },
        },
        reasoning: { effort: 'low' },
      },
    }),
  })
  const body = await res.text()
  if (!res.ok) return new Response(body, { status: res.status })
  return new Response(body, { headers: { 'Content-Type': 'application/json' } })
}
```

- [ ] **Step 2: Реализовать страницу проверки**

`src/app/probe/page.tsx`:

```tsx
'use client'
import { useRef, useState } from 'react'

type Logged = { at: number; type: string; payload: unknown }

export default function ProbePage() {
  const [log, setLog] = useState<Logged[]>([])
  const [status, setStatus] = useState('idle')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const startRef = useRef(0)

  async function start() {
    setStatus('connecting')
    startRef.current = performance.now()
    const tokenRes = await fetch('/api/probe-token', { method: 'POST' })
    const token = await tokenRes.json()

    const pc = new RTCPeerConnection()
    pcRef.current = pc
    const audioEl = document.createElement('audio')
    audioEl.autoplay = true
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0] }

    const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    pc.addTrack(mic.getTracks()[0])

    const dc = pc.createDataChannel('oai-events')
    dc.onmessage = (e) => {
      const payload = JSON.parse(e.data)
      setLog((prev) => [
        ...prev,
        { at: Math.round(performance.now() - startRef.current), type: payload.type, payload },
      ])
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' },
    })
    console.log('Location header (call_id):', sdpRes.headers.get('Location'))
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })
    setStatus('connected')
  }

  function stop() {
    pcRef.current?.close()
    setStatus('stopped')
  }

  function download() {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'probe-events.json'
    a.click()
  }

  const interesting = log.filter((l) =>
    l.type.startsWith('input_audio_buffer') ||
    l.type.includes('transcription') ||
    l.type.includes('output_audio_transcript'),
  )

  return (
    <main className="p-8 font-mono text-sm">
      <div className="flex gap-3">
        <button onClick={start} className="border px-3 py-1">start</button>
        <button onClick={stop} className="border px-3 py-1">stop</button>
        <button onClick={download} className="border px-3 py-1">download json</button>
        <span>status: {status} · events: {log.length}</span>
      </div>
      <ul className="mt-6 space-y-1">
        {interesting.map((l, i) => (
          <li key={i}>
            <span className="text-neutral-500">{l.at}ms</span> {l.type}{' '}
            {JSON.stringify(l.payload).slice(0, 220)}
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Прогнать проверку в браузере**

Run: `npm run dev`, открыть `http://localhost:3000/probe`, нажать start, поговорить с агентом — ответить на три вопроса, **в одном ответе намеренно сделать паузу на 5 секунд посередине**, затем stop и download.

- [ ] **Step 4: Ответить на четыре вопроса по собранному JSON**

Проверить и записать факты, а не ожидания:

1. Приходят ли `input_audio_buffer.speech_started` с полем `audio_start_ms` при `semantic_vad`?
2. Приходят ли `input_audio_buffer.speech_stopped` с `audio_end_ms`?
3. Совпадает ли `item_id` в паре VAD-событий с `item_id` в `conversation.item.input_audio_transcription.completed`?
4. Разрезала ли пауза в 5 секунд ответ на две реплики?

- [ ] **Step 5: Если `audio_start_ms` не приходит — переключить VAD и повторить**

Заменить в `src/app/api/probe-token/route.ts` блок `turn_detection` на:

```ts
turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1500 },
```

`silence_duration_ms: 1500` — чтобы думающего кандидата не обрывало. Повторить шаги 3–4.

- [ ] **Step 6: Записать выводы**

`docs/realtime-probe-findings.md` — что проверено, что подтвердилось, какой `turn_detection` выбран и почему, пример реальной пары событий с `item_id` и таймингами. Этот файл — источник истины для задачи 6.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: страница проверки таймингов Realtime + зафиксированные выводы"
```

---

### Task 3: Типы домена

**Files:**
- Create: `src/lib/types.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `Speaker`, `Turn`, `SessionStatus`, `SessionRecord`, `Metrics`, `Evidence`, `Card` и вложенные типы — на них опираются все дальнейшие задачи

- [ ] **Step 1: Написать файл типов**

`src/lib/types.ts`:

```ts
export type Speaker = 'agent' | 'candidate'

export type Turn = {
  id: string
  speaker: Speaker
  text: string
  tStart: number
  tEnd: number
  timingSource: 'server' | 'client'
}

export type SessionStatus = 'live' | 'interrupted' | 'analyzing' | 'analyzed' | 'failed'

export type Pause = { turnId: string; pauseSec: number }

export type Metrics = {
  durationSec: number
  candidateSpeechSec: number
  agentSpeechSec: number
  candidateSharePct: number
  candidateTurnCount: number
  pauses: Pause[]
  medianPauseSec: number
  longestPauseSec: number
}

export type Evidence = { turnId: string; quote: string }

export type Answered = 'yes' | 'partial' | 'off_topic'

export type QuestionCoverage = {
  questionId: string
  questionLabel: string
  answered: Answered
  note: string
  evidence: Evidence[]
}

export type StarElement = { present: boolean; note: string; evidence: Evidence[] }

export type StructureBlock = {
  summary: string
  coverage: QuestionCoverage[]
  example: { situation: StarElement; action: StarElement; result: StarElement }
}

export type CefrBand = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export type SubscoreName = 'grammar' | 'vocabulary' | 'coherence'

export type CefrSubscore = {
  name: SubscoreName
  band: CefrBand
  note: string
  evidence: Evidence[]
}

export type LanguageBlock = {
  summary: string
  rangeLow: CefrBand
  rangeHigh: CefrBand
  subscores: CefrSubscore[]
}

/** Оценка не выдаётся, когда речи кандидата слишком мало, чтобы её обосновать. */
export type Insufficient = { insufficient: true; reason: string }

export type Confidence = 'low' | 'medium' | 'high'

export type DeliverySignal = {
  label: string
  confidence: Confidence
  whatToCheck: string
  evidence: Evidence[]
}

export type DeliveryBlock = { summary: string; signals: DeliverySignal[] }

export type Fact = { value: string | null; evidence: Evidence[] }

export type Facts = {
  location: Fact
  workRight: Fact
  domainExperience: Fact
  workFormat: Fact
  startDate: Fact
}

export type Card = {
  facts: Facts
  structure: StructureBlock
  language: LanguageBlock | Insufficient
  delivery: DeliveryBlock | Insufficient
  droppedClaims: number
}

export const isInsufficient = (block: unknown): block is Insufficient =>
  !!block && (block as Insufficient).insufficient === true

export type SessionRecord = {
  id: string
  candidateName: string
  roleId: string
  consentAt: string
  status: SessionStatus
  startedAt: string
  endedAt: string | null
  transcript: Turn[]
  metrics: Metrics | null
  card: Card | null
  audioChunks: string[]
  audioUrl: string | null
}
```

- [ ] **Step 2: Проверить компиляцию**

Run: `npx tsc --noEmit`
Expected: без ошибок

- [ ] **Step 3: Коммит**

```bash
git add src/lib/types.ts
git commit -m "feat: типы домена"
```

---

### Task 4: Слой базы данных

**Files:**
- Create: `src/lib/db.ts`
- Create: `scripts/init-db.ts`
- Modify: `package.json` (скрипт `db:init`)

**Interfaces:**
- Consumes: `SessionRecord`, `SessionStatus`, `Turn`, `Metrics`, `Card` из `src/lib/types.ts`
- Produces:
  - `createSession(input: { candidateName: string; roleId: string }): Promise<string>` — возвращает id
  - `getSession(id: string): Promise<SessionRecord | null>`
  - `listSessions(): Promise<Array<Pick<SessionRecord, 'id'|'candidateName'|'roleId'|'status'|'startedAt'|'endedAt'>>>`
  - `saveTurns(id: string, turns: Turn[]): Promise<void>` — полная замена транскрипта
  - `finishSession(id: string, status: SessionStatus): Promise<void>`
  - `setStatus(id: string, status: SessionStatus): Promise<void>`
  - `addAudioChunk(id: string, url: string): Promise<void>`
  - `setAudioUrl(id: string, url: string): Promise<void>`
  - `saveAnalysis(id: string, metrics: Metrics, card: Card): Promise<void>`
  - `countSessionsSince(since: Date): Promise<number>` — для мягкого лимита на прогоны

- [ ] **Step 1: Написать скрипт создания схемы**

`scripts/init-db.ts`:

```ts
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

await sql`
  CREATE TABLE IF NOT EXISTS sessions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_name text        NOT NULL,
    role_id        text        NOT NULL,
    consent_at     timestamptz NOT NULL DEFAULT now(),
    status         text        NOT NULL DEFAULT 'live',
    started_at     timestamptz NOT NULL DEFAULT now(),
    ended_at       timestamptz,
    transcript     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    metrics        jsonb,
    card           jsonb,
    audio_chunks   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    audio_url      text
  )
`
console.log('schema ready')
```

Добавить в `package.json`: `"db:init": "node --env-file=.env.local --experimental-strip-types scripts/init-db.ts"`.

- [ ] **Step 2: Завести базу Neon и применить схему**

Создать проект Neon (или `npx vercel@latest integration add neon`), положить `DATABASE_URL` в `.env.local` и в переменные окружения Vercel, затем:

```bash
npm run db:init
```
Expected: `schema ready`

- [ ] **Step 3: Реализовать слой доступа**

`src/lib/db.ts`:

```ts
import { neon } from '@neondatabase/serverless'
import type { Card, Metrics, SessionRecord, SessionStatus, Turn } from './types'

const sql = neon(process.env.DATABASE_URL!)

type Row = {
  id: string
  candidate_name: string
  role_id: string
  consent_at: string
  status: SessionStatus
  started_at: string
  ended_at: string | null
  transcript: Turn[]
  metrics: Metrics | null
  card: Card | null
  audio_chunks: string[]
  audio_url: string | null
}

function toRecord(row: Row): SessionRecord {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    roleId: row.role_id,
    consentAt: row.consent_at,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    transcript: row.transcript ?? [],
    metrics: row.metrics,
    card: row.card,
    audioChunks: row.audio_chunks ?? [],
    audioUrl: row.audio_url,
  }
}

export async function createSession(input: { candidateName: string; roleId: string }) {
  const rows = (await sql`
    INSERT INTO sessions (candidate_name, role_id)
    VALUES (${input.candidateName}, ${input.roleId})
    RETURNING id
  `) as { id: string }[]
  return rows[0].id
}

export async function getSession(id: string) {
  const rows = (await sql`SELECT * FROM sessions WHERE id = ${id}`) as Row[]
  return rows[0] ? toRecord(rows[0]) : null
}

export async function listSessions() {
  const rows = (await sql`
    SELECT id, candidate_name, role_id, status, started_at, ended_at
    FROM sessions ORDER BY started_at DESC
  `) as Row[]
  return rows.map((r) => ({
    id: r.id,
    candidateName: r.candidate_name,
    roleId: r.role_id,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }))
}

export async function saveTurns(id: string, turns: Turn[]) {
  await sql`UPDATE sessions SET transcript = ${JSON.stringify(turns)}::jsonb WHERE id = ${id}`
}

export async function finishSession(id: string, status: SessionStatus) {
  await sql`UPDATE sessions SET status = ${status}, ended_at = now() WHERE id = ${id}`
}

export async function setStatus(id: string, status: SessionStatus) {
  await sql`UPDATE sessions SET status = ${status} WHERE id = ${id}`
}

export async function addAudioChunk(id: string, url: string) {
  await sql`
    UPDATE sessions SET audio_chunks = audio_chunks || ${JSON.stringify([url])}::jsonb
    WHERE id = ${id}
  `
}

export async function setAudioUrl(id: string, url: string) {
  await sql`UPDATE sessions SET audio_url = ${url} WHERE id = ${id}`
}

export async function countSessionsSince(since: Date) {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM sessions WHERE started_at > ${since.toISOString()}
  `) as { n: number }[]
  return rows[0].n
}

export async function saveAnalysis(id: string, metrics: Metrics, card: Card) {
  await sql`
    UPDATE sessions
    SET metrics = ${JSON.stringify(metrics)}::jsonb,
        card    = ${JSON.stringify(card)}::jsonb,
        status  = 'analyzed'
    WHERE id = ${id}
  `
}
```

- [ ] **Step 4: Проверить работу вручную**

```bash
node --env-file=.env.local --experimental-strip-types -e "
import { createSession, getSession, listSessions } from './src/lib/db.ts'
const id = await createSession({ candidateName: 'Probe', roleId: 'unimatch-default' })
console.log(await getSession(id))
console.log((await listSessions()).length)
"
```
Expected: объект сессии со статусом `live` и пустым транскриптом, длина списка ≥ 1

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat: схема и слой доступа к сессиям"
```

---

### Task 5: Конфиг роли и инструкции агента

**Files:**
- Create: `config/roles/unimatch-default.json`
- Create: `src/lib/roles.ts`
- Create: `tests/roles.test.ts`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `type RoleConfig = { id, company, role, pitch, questions: RoleQuestion[], faq: { q: string; a: string }[] }`
  - `type RoleQuestion = { id: string; label: string; ask: string; needsExample?: boolean }`
  - `loadRole(id: string): RoleConfig`
  - `buildInstructions(role: RoleConfig): string`

- [ ] **Step 1: Написать конфиг роли**

Содержание — черновик до ответов заказчика (см. `CUSTOMER-QUESTIONS.md`); меняется одним файлом.

`config/roles/unimatch-default.json`:

```json
{
  "id": "unimatch-default",
  "company": "Unimatch helps students find and apply to universities abroad. The team is small, remote-first, and works across several time zones.",
  "role": "Student Success Manager — guiding applicants through the admission process in English, by video call and in writing.",
  "pitch": "You would own a portfolio of applicants end to end: understanding what they want, matching them with programmes, and keeping their application on track until they are admitted.",
  "questions": [
    { "id": "location", "label": "Локация и право на работу", "ask": "Where are you based right now, and are you legally allowed to work from there as a contractor?" },
    { "id": "experience", "label": "Опыт в домене + пример", "ask": "Tell me about your experience working directly with clients or students. Then walk me through one specific case you handled yourself.", "needsExample": true },
    { "id": "format", "label": "Формат работы", "ask": "What working setup are you looking for — full time or part time, and how do you feel about a fully remote team across time zones?" },
    { "id": "start", "label": "Срок выхода", "ask": "If we moved forward, when could you realistically start?" }
  ],
  "faq": [
    { "q": "compensation", "a": "The range depends on experience and is discussed with the recruiter on the next call." },
    { "q": "process", "a": "This screening, then a call with the hiring manager, then a short practical task." },
    { "q": "hours", "a": "The team overlaps for a few hours a day; the rest of the schedule is flexible." }
  ]
}
```

- [ ] **Step 2: Написать падающий тест**

`tests/roles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadRole, buildInstructions } from '@/lib/roles'

describe('roles', () => {
  it('загружает конфиг роли', () => {
    const role = loadRole('unimatch-default')
    expect(role.questions).toHaveLength(4)
    expect(role.questions[0].id).toBe('location')
  })

  it('падает на неизвестной роли', () => {
    expect(() => loadRole('nope')).toThrow(/nope/)
  })

  it('инструкции содержат все вопросы и запрет менять язык', () => {
    const text = buildInstructions(loadRole('unimatch-default'))
    for (const q of loadRole('unimatch-default').questions) {
      expect(text).toContain(q.ask)
    }
    expect(text).toMatch(/English/)
  })

  it('инструкции не содержат рубрику оценки', () => {
    const text = buildInstructions(loadRole('unimatch-default')).toLowerCase()
    for (const forbidden of ['cefr', 'score', 'rubric', 'assess', 'evaluate']) {
      expect(text).not.toContain(forbidden)
    }
  })
})
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/roles.test.ts`
Expected: FAIL — нет модуля `@/lib/roles`

- [ ] **Step 4: Реализовать загрузку и сборку инструкций**

`src/lib/roles.ts`:

```ts
import unimatchDefault from '../../config/roles/unimatch-default.json'

export type RoleQuestion = { id: string; label: string; ask: string; needsExample?: boolean }
export type RoleConfig = {
  id: string
  company: string
  role: string
  pitch: string
  questions: RoleQuestion[]
  faq: { q: string; a: string }[]
}

/**
 * Роли подключаются статическим импортом, а не чтением с диска: файл, который читают
 * через fs из process.cwd(), может не попасть в serverless-бандл Vercel — и тогда
 * локально всё работает, а в проде роут падает.
 */
const ROLES: Record<string, RoleConfig> = {
  'unimatch-default': unimatchDefault as RoleConfig,
}

export function loadRole(id: string): RoleConfig {
  const role = ROLES[id]
  if (!role) throw new Error(`Unknown role: ${id}`)
  return role
}

export function buildInstructions(role: RoleConfig): string {
  const questions = role.questions
    .map((q, i) => `${i + 1}. [${q.id}] ${q.ask}${q.needsExample ? ' Insist on one concrete case they handled personally.' : ''}`)
    .join('\n')

  const faq = role.faq.map((f) => `- ${f.q}: ${f.a}`).join('\n')

  return `You are a recruiter at Unimatch running a first-round screening call. Speak English only. If the candidate switches to another language, warmly ask them to continue in English, because the role requires it.

ABOUT THE COMPANY
${role.company}

ABOUT THE ROLE
${role.role}
${role.pitch}

HOW THE CALL GOES
1. Greet the candidate by name, introduce yourself as Unimatch's screening assistant, and say the call takes about ten minutes.
2. Spend about thirty seconds on the company and the role. Do not read it out like a script.
3. Work through the questions below in order.
4. Ask if they have a question for you, then close the call warmly and tell them the recruiter follows up by email.

QUESTIONS
${questions}

HOW TO ASK
- Ask one question at a time and wait for the full answer.
- Follow up when an answer is thin — but at most twice per question, then move on.
- When they give an example, make sure you learn what the situation was, what they personally did, and how it ended. If any of the three is missing, ask for that piece specifically.
- If an answer does not address what you asked, rephrase the question once. If it still does not, move on without commenting on it.
- Never fill a silence for them. If they pause, wait. Only if they stay silent twice in a row, offer to move to the next question.
- Keep your own turns short — under thirty words unless you are describing the role.

IF THEY ASK YOU SOMETHING
${faq}
For anything else, say honestly that the recruiter will answer on the next call.

WHEN THE QUESTIONS ARE DONE
Thank them, say the recruiter will be in touch, and stop talking.`
}
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/roles.test.ts`
Expected: PASS, 4 теста

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat: конфиг роли и сборка инструкций агента"
```

---

### Task 6: Сборка реплик из событий Realtime

Ядро доказательной базы. Реализуется по фактам из `docs/realtime-probe-findings.md` (задача 2).

**Files:**
- Create: `src/lib/turns.ts`
- Create: `tests/turns.test.ts`

**Interfaces:**
- Consumes: `Turn` из `src/lib/types.ts`
- Produces:
  - `type StampedEvent = { clientTimeSec: number; event: Record<string, unknown> }`
  - `assembleTurns(events: StampedEvent[]): Turn[]` — реплики, отсортированные по `tStart`

- [ ] **Step 1: Написать падающий тест**

`tests/turns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assembleTurns, type StampedEvent } from '@/lib/turns'

const ev = (clientTimeSec: number, event: Record<string, unknown>): StampedEvent => ({ clientTimeSec, event })

describe('assembleTurns', () => {
  it('склеивает тайминги кандидата с транскрипцией по item_id', () => {
    const turns = assembleTurns([
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'msg_7' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'msg_7' }),
      ev(16.4, {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'msg_7',
        transcript: 'I led a team of six',
      }),
    ])
    expect(turns).toEqual([
      { id: 'msg_7', speaker: 'candidate', text: 'I led a team of six', tStart: 12.4, tEnd: 15.9, timingSource: 'server' },
    ])
  })

  it('переживает транскрипцию, пришедшую раньше VAD-событий', () => {
    const turns = assembleTurns([
      ev(16.4, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'm1', transcript: 'hello' }),
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'm1' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'm1' }),
    ])
    expect(turns[0].tStart).toBe(12.4)
    expect(turns[0].timingSource).toBe('server')
  })

  it('ставит реплики агента на ту же шкалу через калибровку', () => {
    // speech_started: серверные 12.4с при клиентских 12.5с → сдвиг -0.1с
    const turns = assembleTurns([
      ev(4.0, { type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'Where are you based?' }),
      ev(12.5, { type: 'input_audio_buffer.speech_started', audio_start_ms: 12400, item_id: 'msg_7' }),
      ev(16.0, { type: 'input_audio_buffer.speech_stopped', audio_end_ms: 15900, item_id: 'msg_7' }),
      ev(16.4, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'msg_7', transcript: 'Berlin' }),
    ])
    const agent = turns.find((t) => t.speaker === 'agent')!
    expect(agent.tEnd).toBeCloseTo(3.9, 3)
    expect(agent.timingSource).toBe('client')
    expect(turns.map((t) => t.speaker)).toEqual(['agent', 'candidate'])
  })

  it('без серверных таймингов не падает, а помечает источник как клиентский', () => {
    const turns = assembleTurns([
      ev(5.0, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'm1', transcript: 'hi' }),
    ])
    expect(turns[0].timingSource).toBe('client')
    expect(turns[0].tEnd).toBe(5.0)
  })

  it('выбрасывает пустые транскрипции и не дублирует item_id', () => {
    const turns = assembleTurns([
      ev(1.0, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'm1', transcript: '   ' }),
      ev(2.0, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'm2', transcript: 'ok' }),
      ev(2.5, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'm2', transcript: 'ok' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].id).toBe('m2')
  })

  it('игнорирует незнакомые события', () => {
    expect(assembleTurns([ev(1, { type: 'session.updated' })])).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/turns.test.ts`
Expected: FAIL — нет модуля `@/lib/turns`

- [ ] **Step 3: Реализовать сборку**

`src/lib/turns.ts`:

```ts
import type { Turn } from './types'

export type StampedEvent = { clientTimeSec: number; event: Record<string, unknown> }

type Timing = { tStart?: number; tEnd?: number }

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/**
 * Тайминги кандидата берутся из VAD-событий (серверные, в мс от начала аудио сессии)
 * и склеиваются с текстом по item_id. Для агента серверных таймингов не существует,
 * поэтому его реплики переводятся на ту же шкалу через сдвиг, замеренный на первом
 * совпадении серверного и клиентского времени.
 */
export function assembleTurns(events: StampedEvent[]): Turn[] {
  const timings = new Map<string, Timing>()
  let offset: number | null = null

  for (const { clientTimeSec, event } of events) {
    const type = str(event.type)
    const itemId = str(event.item_id)
    if (!itemId) continue

    if (type === 'input_audio_buffer.speech_started') {
      const ms = num(event.audio_start_ms)
      if (ms === undefined) continue
      const tStart = ms / 1000
      timings.set(itemId, { ...timings.get(itemId), tStart })
      if (offset === null) offset = tStart - clientTimeSec
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      const ms = num(event.audio_end_ms)
      if (ms === undefined) continue
      timings.set(itemId, { ...timings.get(itemId), tEnd: ms / 1000 })
    }
  }

  const shift = (clientTimeSec: number) => Math.max(0, clientTimeSec + (offset ?? 0))
  const turns = new Map<string, Turn>()

  for (const { clientTimeSec, event } of events) {
    const type = str(event.type)
    const itemId = str(event.item_id)
    if (!itemId || turns.has(itemId)) continue

    const isCandidate = type === 'conversation.item.input_audio_transcription.completed'
    const isAgent = type === 'response.output_audio_transcript.done'
    if (!isCandidate && !isAgent) continue

    const text = (str(event.transcript) ?? '').trim()
    if (!text) continue

    const timing = isCandidate ? timings.get(itemId) : undefined
    const hasServerTiming = timing?.tStart !== undefined

    turns.set(itemId, {
      id: itemId,
      speaker: isCandidate ? 'candidate' : 'agent',
      text,
      tStart: hasServerTiming ? timing!.tStart! : shift(clientTimeSec),
      tEnd: timing?.tEnd ?? shift(clientTimeSec),
      timingSource: hasServerTiming ? 'server' : 'client',
    })
  }

  return [...turns.values()].sort((a, b) => a.tStart - b.tStart)
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/turns.test.ts`
Expected: PASS, 6 тестов

- [ ] **Step 5: Сверить с реальными данными**

Скормить `assembleTurns` реальный `probe-events.json` из задачи 2 (расставив `clientTimeSec` из поля `at`, поделив на 1000) и глазами проверить: реплики идут в том порядке, в каком шёл разговор, тайминги кандидата помечены `server`.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat: сборка реплик из событий Realtime с серверными таймингами"
```

---

### Task 7: Роут создания сессии и эфемерного ключа

**Files:**
- Create: `src/app/api/session/route.ts`
- Create: `tests/session-route.test.ts`

**Interfaces:**
- Consumes: `createSession` из `@/lib/db`; `loadRole`, `buildInstructions` из `@/lib/roles`
- Produces: `POST /api/session` с телом `{ candidateName: string, roleId?: string }` → `{ sessionId: string, clientSecret: string }`; ошибки — `{ error: string }` со статусом 400 или 502

- [ ] **Step 1: Написать падающий тест**

`tests/session-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ createSession: vi.fn(async () => 'sess-1') }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/session/route')
  return POST(new Request('http://x/api/session', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.resetModules()
  process.env.OPENAI_API_KEY = 'sk-test'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: 'ek_123' }), { status: 200 })))
})

describe('POST /api/session', () => {
  it('требует имя кандидата', async () => {
    const res = await post({ candidateName: '  ' })
    expect(res.status).toBe(400)
  })

  it('возвращает эфемерный ключ и id сессии', async () => {
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sessionId: 'sess-1', clientSecret: 'ek_123' })
  })

  it('отдаёт понятную ошибку, когда OpenAI отказал', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))
    const res = await post({ candidateName: 'Pavel' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/OpenAI/)
  })

  it('не кладёт рубрику оценки в инструкции сессии', async () => {
    await post({ candidateName: 'Pavel' })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.session.instructions.toLowerCase()).not.toContain('cefr')
    expect(body.session.audio.input.transcription.model).toBe('gpt-4o-transcribe')
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/session-route.test.ts`
Expected: FAIL — нет модуля роута

- [ ] **Step 3: Реализовать роут**

Значение `turn_detection` взять из `docs/realtime-probe-findings.md` — то, которое подтвердилось в задаче 2.

`src/app/api/session/route.ts`:

```ts
import { countSessionsSince, createSession } from '@/lib/db'
import { buildInstructions, loadRole } from '@/lib/roles'

const DEFAULT_ROLE = 'unimatch-default'
const MAX_SESSIONS_PER_HOUR = 30

export async function POST(req: Request) {
  let payload: { candidateName?: string; roleId?: string }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const candidateName = (payload.candidateName ?? '').trim()
  if (!candidateName) return Response.json({ error: 'Candidate name is required' }, { status: 400 })

  const roleId = payload.roleId ?? DEFAULT_ROLE
  let role
  try {
    role = loadRole(roleId)
  } catch {
    return Response.json({ error: `Unknown role: ${roleId}` }, { status: 400 })
  }

  // Демо-ссылка публичная, а квота одна: лучше честный отказ здесь, чем сгоревшая
  // квота посреди чужого интервью.
  const recent = await countSessionsSince(new Date(Date.now() - 60 * 60 * 1000))
  if (recent >= MAX_SESSIONS_PER_HOUR) {
    return Response.json(
      { error: 'This demo has hit its hourly interview limit. Please try again in an hour.' },
      { status: 429 },
    )
  }

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: `${buildInstructions(role)}\n\nThe candidate's name is ${candidateName}.`,
        audio: {
          input: {
            transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: { type: 'semantic_vad', eagerness: 'low' },
          },
          output: { voice: 'marin' },
        },
        reasoning: { effort: 'low' },
      },
    }),
  })

  if (!res.ok) {
    console.error('client_secrets failed', res.status, await res.text())
    return Response.json(
      { error: 'OpenAI is not accepting calls right now. Please try again in a minute.' },
      { status: 502 },
    )
  }

  const secret = (await res.json()) as { value?: string }
  if (!secret.value) return Response.json({ error: 'OpenAI returned no client secret' }, { status: 502 })

  const sessionId = await createSession({ candidateName, roleId })
  return Response.json({ sessionId, clientSecret: secret.value })
}
```

Ключ запрашивается **до** создания строки сессии: если у OpenAI кончилась квота, мы не оставляем в дашборде мусорную сессию, которая никогда не начнётся.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/session-route.test.ts`
Expected: PASS, 4 теста

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat: роут создания сессии и выдачи эфемерного ключа"
```

---

### Task 8: Роут инкрементальной записи реплик

**Files:**
- Create: `src/app/api/turns/route.ts`
- Create: `tests/turns-route.test.ts`

**Interfaces:**
- Consumes: `saveTurns`, `finishSession`, `getSession` из `@/lib/db`; `runAnalysis` из `@/lib/analyze/run` (задача 16 — до неё роут импортирует функцию, которой ещё нет, поэтому заглушка `src/lib/analyze/run.ts` с `export async function runAnalysis(sessionId: string) {}` создаётся здесь и наполняется в задаче 16)
- Produces: `POST /api/turns` с телом `{ sessionId: string, turns: Turn[], done?: boolean, status?: 'interrupted' }` → `{ saved: number }`; при `done` сам запускает анализ

- [ ] **Step 1: Написать падающий тест**

`tests/turns-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveTurns = vi.fn(async () => {})
const finishSession = vi.fn(async () => {})
const getSession = vi.fn(async () => ({ id: 's1', status: 'live' }))
const runAnalysis = vi.fn(async () => ({ droppedClaims: 0 }))

vi.mock('@/lib/db', () => ({ saveTurns, finishSession, getSession }))
vi.mock('@/lib/analyze/run', () => ({ runAnalysis }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/turns/route')
  return POST(new Request('http://x/api/turns', { method: 'POST', body: JSON.stringify(body) }))
}

const turn = { id: 't1', speaker: 'candidate', text: 'hi', tStart: 1, tEnd: 2, timingSource: 'server' }

beforeEach(() => vi.clearAllMocks())

describe('POST /api/turns', () => {
  it('сохраняет реплики', async () => {
    const res = await post({ sessionId: 's1', turns: [turn] })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ saved: 1 })
    expect(saveTurns).toHaveBeenCalledWith('s1', [turn])
    expect(finishSession).not.toHaveBeenCalled()
  })

  it('закрывает сессию и сам запускает анализ при done', async () => {
    await post({ sessionId: 's1', turns: [turn], done: true })
    expect(finishSession).toHaveBeenCalledWith('s1', 'analyzing')
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('прерванную сессию помечает и всё равно анализирует', async () => {
    await post({ sessionId: 's1', turns: [turn], done: true, status: 'interrupted' })
    expect(finishSession).toHaveBeenCalledWith('s1', 'interrupted')
    expect(runAnalysis).toHaveBeenCalledWith('s1')
  })

  it('падение анализа не ломает сохранение реплик', async () => {
    runAnalysis.mockRejectedValueOnce(new Error('model exploded') as never)
    const res = await post({ sessionId: 's1', turns: [turn], done: true })
    expect(res.status).toBe(200)
  })

  it('404 на неизвестной сессии', async () => {
    getSession.mockResolvedValueOnce(null as never)
    expect((await post({ sessionId: 'nope', turns: [] })).status).toBe(404)
  })

  it('400 на мусорных репликах', async () => {
    expect((await post({ sessionId: 's1', turns: [{ id: 'x' }] })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/turns-route.test.ts`
Expected: FAIL — нет модуля роута

- [ ] **Step 3: Реализовать роут**

`src/app/api/turns/route.ts`:

```ts
import { runAnalysis } from '@/lib/analyze/run'
import { finishSession, getSession, saveTurns } from '@/lib/db'
import type { Turn } from '@/lib/types'

// Анализ идёт внутри этого же запроса: на Vercel потолок 300 секунд на всех тарифах,
// анализ укладывается с большим запасом. Клиент анализ не дёргает — иначе закрытая
// вкладка осталась бы без карточки.
export const maxDuration = 300

function isTurn(v: unknown): v is Turn {
  const t = v as Turn
  return (
    !!t &&
    typeof t.id === 'string' &&
    (t.speaker === 'agent' || t.speaker === 'candidate') &&
    typeof t.text === 'string' &&
    typeof t.tStart === 'number' &&
    typeof t.tEnd === 'number' &&
    (t.timingSource === 'server' || t.timingSource === 'client')
  )
}

export async function POST(req: Request) {
  let payload: { sessionId?: string; turns?: unknown; done?: boolean; status?: string }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const { sessionId } = payload
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })
  if (!Array.isArray(payload.turns) || !payload.turns.every(isTurn)) {
    return Response.json({ error: 'turns must be an array of turns' }, { status: 400 })
  }

  if (!(await getSession(sessionId))) return Response.json({ error: 'Unknown session' }, { status: 404 })

  const turns = payload.turns as Turn[]
  await saveTurns(sessionId, turns)

  if (!payload.done) return Response.json({ saved: turns.length })

  await finishSession(sessionId, payload.status === 'interrupted' ? 'interrupted' : 'analyzing')
  try {
    await runAnalysis(sessionId)
  } catch (err) {
    // Реплики уже сохранены, статус проставлен внутри runAnalysis. Ронять запрос нельзя:
    // клиента может уже не быть, а транскрипт терять из-за упавшего анализа глупо.
    console.error('analysis after interview failed', sessionId, err)
  }
  return Response.json({ saved: turns.length })
}
```

- [ ] **Step 4: Создать заглушку анализа**

Роут импортирует `runAnalysis`, которая наполняется в задаче 16. Чтобы задача была
самодостаточной и тесты проходили, создать `src/lib/analyze/run.ts`:

```ts
/** Наполняется в задаче 16. Здесь — чтобы роут /api/turns был работоспособен и тестируем. */
export async function runAnalysis(sessionId: string): Promise<{ droppedClaims: number }> {
  console.warn('runAnalysis is not implemented yet', sessionId)
  return { droppedClaims: 0 }
}
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/turns-route.test.ts`
Expected: PASS, 6 тестов

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "feat: роут записи реплик, запускающий анализ на сервере"
```

---

### Task 9: Запись аудио и загрузка чанков

**Files:**
- Create: `src/app/api/blob-token/route.ts`
- Create: `src/lib/recorder.ts`
- Create: `tests/recorder.test.ts`

**Interfaces:**
- Consumes: `addAudioChunk` из `@/lib/db`
- Produces:
  - `POST /api/blob-token` — обработчик клиентской загрузки `@vercel/blob/client`
  - `class InterviewRecorder { constructor(sessionId: string); start(mic: MediaStream, remote: MediaStream): Promise<void>; stop(): Promise<void>; get chunkCount(): number }`
  - `mixStreams(ctx: AudioContext, streams: MediaStream[]): MediaStream` — экспортируется отдельно для теста

- [ ] **Step 1: Реализовать роут токена загрузки**

`src/app/api/blob-token/route.ts`:

```ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { addAudioChunk, getSession } from '@/lib/db'

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const sessionId = String(clientPayload ?? '')
        if (!sessionId || !(await getSession(sessionId))) throw new Error('Unknown session')
        if (!pathname.startsWith(`interviews/${sessionId}/`)) throw new Error('Bad pathname')
        return {
          allowedContentTypes: ['audio/webm', 'video/webm', 'audio/mp4'],
          addRandomSuffix: false,
          tokenPayload: sessionId,
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await addAudioChunk(String(tokenPayload), blob.url)
      },
    })
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
```

`onUploadCompleted` не вызывается на `localhost` — Vercel не может достучаться до локальной машины. Это ожидаемо: чанки на проде записываются, локально проверяем сам факт загрузки. Отметить это в README.

- [ ] **Step 2: Написать падающий тест смешивания потоков**

`tests/recorder.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mixStreams } from '@/lib/recorder'

describe('mixStreams', () => {
  it('подключает каждый входной поток к общему выходу', () => {
    const connect = vi.fn()
    const destination = { stream: { id: 'mixed' } }
    const ctx = {
      createMediaStreamSource: vi.fn(() => ({ connect })),
      createMediaStreamDestination: vi.fn(() => destination),
    } as unknown as AudioContext

    const a = { id: 'mic' } as MediaStream
    const b = { id: 'agent' } as MediaStream
    const out = mixStreams(ctx, [a, b])

    expect(ctx.createMediaStreamSource).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledWith(destination)
    expect(out).toBe(destination.stream)
  })
})
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/recorder.test.ts`
Expected: FAIL — нет модуля `@/lib/recorder`

- [ ] **Step 4: Реализовать запись**

`src/lib/recorder.ts`:

```ts
import { upload } from '@vercel/blob/client'

const CHUNK_MS = 15_000

/** Микрофон и трек агента идут в один выход: писать только микрофон значит потерять голос агента. */
export function mixStreams(ctx: AudioContext, streams: MediaStream[]): MediaStream {
  const destination = ctx.createMediaStreamDestination()
  for (const stream of streams) ctx.createMediaStreamSource(stream).connect(destination)
  return destination.stream
}

function pickMimeType(): string | undefined {
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

  async start(mic: MediaStream, remote: MediaStream) {
    this.ctx = new AudioContext()
    const mixed = mixStreams(this.ctx, [mic, remote])
    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.pending.push(this.uploadChunk(e.data))
    }
    this.recorder.start(CHUNK_MS)
  }

  private async uploadChunk(data: Blob) {
    const name = String(this.index++).padStart(4, '0')
    try {
      await upload(`interviews/${this.sessionId}/${name}.webm`, data, {
        access: 'public',
        handleUploadUrl: '/api/blob-token',
        clientPayload: this.sessionId,
        contentType: data.type || 'audio/webm',
      })
    } catch (err) {
      // Потеря чанка не должна ронять интервью: разговор важнее записи.
      console.error('chunk upload failed', name, err)
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
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/recorder.test.ts`
Expected: PASS

- [ ] **Step 6: Связать Blob-стор и задеплоить**

```bash
npx vercel@latest blob store add scoring-agent-audio
npx vercel@latest env pull .env.local
npx vercel@latest --prod
```

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: запись смешанного потока и загрузка чанков в Blob"
```

---

### Task 10: Клиент Realtime и хук интервью

**Files:**
- Create: `src/lib/realtime-client.ts`
- Create: `src/hooks/useInterview.ts`
- Create: `tests/realtime-client.test.ts`

**Interfaces:**
- Consumes: `assembleTurns`, `StampedEvent` из `@/lib/turns`; `InterviewRecorder` из `@/lib/recorder`
- Produces:
  - `connectRealtime(opts: { clientSecret: string; mic: MediaStream; onEvent: (e: Record<string, unknown>) => void; onRemoteStream: (s: MediaStream) => void }): Promise<{ pc: RTCPeerConnection; callId: string | null }>`
  - `useInterview()` → `{ phase, error, turns, start(candidateName), end(), sessionId }`, где `phase: 'idle'|'connecting'|'live'|'ending'|'done'|'error'`

- [ ] **Step 1: Написать падающий тест клиента**

`tests/realtime-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { connectRealtime } from '@/lib/realtime-client'

let channel: { onmessage: ((e: MessageEvent) => void) | null }
let pcInstance: Record<string, unknown>

beforeEach(() => {
  channel = { onmessage: null }
  pcInstance = {
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER_SDP' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addTrack: vi.fn(),
    close: vi.fn(),
  }
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => pcInstance))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('ANSWER_SDP', { status: 200, headers: { Location: '/v1/realtime/calls/rtc_42' } })),
  )
})

const mic = { getTracks: () => [{ kind: 'audio' }] } as unknown as MediaStream

describe('connectRealtime', () => {
  it('шлёт SDP на /v1/realtime/calls с эфемерным ключом и открывает канал oai-events', async () => {
    const { callId } = await connectRealtime({ clientSecret: 'ek_1', mic, onEvent: vi.fn(), onRemoteStream: vi.fn() })

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/realtime/calls')
    expect(init.body).toBe('OFFER_SDP')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ek_1')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/sdp')
    expect(pcInstance.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(callId).toBe('rtc_42')
  })

  it('прокидывает разобранные события наружу', async () => {
    const onEvent = vi.fn()
    await connectRealtime({ clientSecret: 'ek_1', mic, onEvent, onRemoteStream: vi.fn() })
    channel.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) } as MessageEvent)
    expect(onEvent).toHaveBeenCalledWith({ type: 'session.updated' })
  })

  it('бросает понятную ошибку, когда handshake не удался', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      connectRealtime({ clientSecret: 'ek_bad', mic, onEvent: vi.fn(), onRemoteStream: vi.fn() }),
    ).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/realtime-client.test.ts`
Expected: FAIL — нет модуля `@/lib/realtime-client`

- [ ] **Step 3: Реализовать клиент**

`src/lib/realtime-client.ts`:

```ts
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export async function connectRealtime(opts: {
  clientSecret: string
  mic: MediaStream
  onEvent: (event: Record<string, unknown>) => void
  onRemoteStream: (stream: MediaStream) => void
}) {
  const pc = new RTCPeerConnection()
  pc.ontrack = (e) => opts.onRemoteStream(e.streams[0])
  for (const track of opts.mic.getTracks()) pc.addTrack(track, opts.mic)

  const channel = pc.createDataChannel('oai-events')
  channel.onmessage = (e) => {
    try {
      opts.onEvent(JSON.parse(e.data))
    } catch {
      // нечитаемое сообщение канала не должно ронять разговор
    }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const res = await fetch(CALLS_URL, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${opts.clientSecret}`, 'Content-Type': 'application/sdp' },
  })
  if (!res.ok) {
    pc.close()
    throw new Error(`Realtime handshake failed: ${res.status} ${await res.text()}`)
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  return { pc, callId: res.headers.get('Location')?.split('/').pop() ?? null }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/realtime-client.test.ts`
Expected: PASS, 3 теста

- [ ] **Step 5: Реализовать хук интервью**

`src/hooks/useInterview.ts`:

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectRealtime } from '@/lib/realtime-client'
import { InterviewRecorder } from '@/lib/recorder'
import { assembleTurns, type StampedEvent } from '@/lib/turns'
import type { Turn } from '@/lib/types'

export type Phase = 'idle' | 'connecting' | 'live' | 'ending' | 'done' | 'error'

const FLUSH_MS = 4000

export function useInterview() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const events = useRef<StampedEvent[]>([])
  const pc = useRef<RTCPeerConnection | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const recorder = useRef<InterviewRecorder | null>(null)
  const startedAt = useRef(0)
  const flusher = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionRef = useRef<string | null>(null)
  const ended = useRef(false)

  const persist = useCallback(async (done: boolean, status?: 'interrupted') => {
    const id = sessionRef.current
    if (!id) return
    const body = JSON.stringify({ sessionId: id, turns: assembleTurns(events.current), done, status })
    if (done && 'sendBeacon' in navigator) {
      navigator.sendBeacon('/api/turns', new Blob([body], { type: 'application/json' }))
      return
    }
    await fetch('/api/turns', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
  }, [])

  const end = useCallback(async (status?: 'interrupted') => {
    if (ended.current) return
    ended.current = true
    setPhase('ending')
    if (flusher.current) clearInterval(flusher.current)
    pc.current?.close()
    mic.current?.getTracks().forEach((t) => t.stop())
    await recorder.current?.stop()
    await persist(true, status)
    const id = sessionRef.current
    if (id && status !== 'interrupted') {
      fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ sessionId: id }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {})
    }
    setPhase('done')
  }, [persist])

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

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mic.current = stream

        recorder.current = new InterviewRecorder(data.sessionId)
        startedAt.current = performance.now()

        const conn = await connectRealtime({
          clientSecret: data.clientSecret,
          mic: stream,
          onEvent: (event) => {
            events.current.push({ clientTimeSec: (performance.now() - startedAt.current) / 1000, event })
            setTurns(assembleTurns(events.current))
          },
          onRemoteStream: (remote) => {
            const el = new Audio()
            el.autoplay = true
            el.srcObject = remote
            void el.play().catch(() => {})
            void recorder.current?.start(stream, remote)
          },
        })
        pc.current = conn.pc

        conn.pc.onconnectionstatechange = () => {
          if (['failed', 'closed', 'disconnected'].includes(conn.pc.connectionState) && !ended.current) {
            void end('interrupted')
          }
        }

        flusher.current = setInterval(() => void persist(false), FLUSH_MS)
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
      if (sessionRef.current && !ended.current) void persist(true, 'interrupted')
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [persist])

  return { phase, error, turns, sessionId, start, end }
}
```

- [ ] **Step 6: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: клиент Realtime и хук управления интервью"
```

---

### Task 11: Кандидатский флоу

**Files:**
- Create: `src/components/interview/ConsentScreen.tsx`
- Create: `src/components/interview/MicCheck.tsx`
- Create: `src/components/interview/LiveCall.tsx`
- Create: `src/components/interview/ThankYou.tsx`
- Create: `src/app/interview/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `useInterview` из `@/hooks/useInterview`
- Produces: `/interview` — рабочий путь согласие → микрофон → разговор → спасибо. Весь текст на английском

- [ ] **Step 1: Реализовать экран согласия**

`src/components/interview/ConsentScreen.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function ConsentScreen({ onReady }: { onReady: (name: string) => void }) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canStart = name.trim().length > 1 && agreed

  return (
    <section className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Before we start</h1>
      <p className="text-neutral-600">
        This is a first-round screening call with Unimatch. It runs in English and takes about ten
        minutes. You will talk to an AI assistant, and a human recruiter reads the result afterwards.
      </p>
      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
          placeholder="Alex Smith"
        />
      </label>
      <label className="flex gap-3 rounded border p-4">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span className="text-sm text-neutral-700">
          I agree that this conversation is recorded and transcribed so a Unimatch recruiter can review
          it. The recruiter makes the hiring decision, not the assistant.
        </span>
      </label>
      <button
        disabled={!canStart}
        onClick={() => onReady(name.trim())}
        className="rounded bg-black px-5 py-2.5 text-white disabled:opacity-40"
      >
        Continue
      </button>
    </section>
  )
}
```

- [ ] **Step 2: Реализовать проверку микрофона**

`src/components/interview/MicCheck.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'

export function MicCheck({ onReady, onError }: { onReady: () => void; onError: (m: string) => void }) {
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
          const peak = Math.max(...Array.from(data, (v) => Math.abs(v - 128))) / 128
          setLevel(peak)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() =>
        onError('We could not reach your microphone. Allow microphone access in your browser, then reload this page.'),
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
        <div className="h-full bg-black transition-[width]" style={{ width: `${Math.min(100, level * 160)}%` }} />
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
```

- [ ] **Step 3: Реализовать экран разговора**

`src/components/interview/LiveCall.tsx`:

```tsx
'use client'
import type { Turn } from '@/lib/types'

export function LiveCall({ turns, onEnd }: { turns: Turn[]; onEnd: () => void }) {
  return (
    <section className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <h1 className="text-xl font-semibold">The interview is running</h1>
      </div>
      <p className="text-neutral-600">
        Just talk normally. Take your time before answering — pauses are fine and are not held against you.
      </p>
      <ul className="space-y-3">
        {turns.map((t) => (
          <li key={t.id} className={t.speaker === 'agent' ? 'text-neutral-500' : 'font-medium'}>
            <span className="mr-2 text-xs uppercase tracking-wide text-neutral-400">
              {t.speaker === 'agent' ? 'Recruiter' : 'You'}
            </span>
            {t.text}
          </li>
        ))}
      </ul>
      <button onClick={onEnd} className="rounded border px-5 py-2.5">
        End the interview
      </button>
    </section>
  )
}
```

- [ ] **Step 4: Реализовать экран благодарности**

`src/components/interview/ThankYou.tsx`:

```tsx
export function ThankYou({ sessionId }: { sessionId: string | null }) {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  return (
    <section className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">Thank you</h1>
      <p className="text-neutral-600">
        That is the whole screening. A Unimatch recruiter reviews the conversation and follows up by email.
      </p>
      {demo && sessionId && (
        <p className="rounded border border-dashed p-4 text-sm">
          Demo build: the recruiter card is at{' '}
          <a className="underline" href={`/card/${sessionId}`}>
            /card/{sessionId}
          </a>
          . In production a candidate would not see this link.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Собрать страницу интервью**

`src/app/interview/page.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useInterview } from '@/hooks/useInterview'
import { ConsentScreen } from '@/components/interview/ConsentScreen'
import { MicCheck } from '@/components/interview/MicCheck'
import { LiveCall } from '@/components/interview/LiveCall'
import { ThankYou } from '@/components/interview/ThankYou'

type Step = 'consent' | 'mic' | 'call'

export default function InterviewPage() {
  const [step, setStep] = useState<Step>('consent')
  const [name, setName] = useState('')
  const [micError, setMicError] = useState<string | null>(null)
  const { phase, error, turns, sessionId, start, end } = useInterview()

  const problem = micError ?? error
  if (problem) {
    return (
      <section className="mx-auto max-w-xl space-y-5 p-8">
        <h1 className="text-2xl font-semibold">We hit a problem</h1>
        <p className="text-neutral-700">{problem}</p>
        <button onClick={() => location.reload()} className="rounded bg-black px-5 py-2.5 text-white">
          Try again
        </button>
      </section>
    )
  }

  if (phase === 'done' || phase === 'ending') return <ThankYou sessionId={sessionId} />

  if (step === 'consent') {
    return (
      <ConsentScreen
        onReady={(n) => {
          setName(n)
          setStep('mic')
        }}
      />
    )
  }

  if (step === 'mic') {
    return (
      <MicCheck
        onError={setMicError}
        onReady={() => {
          setStep('call')
          void start(name)
        }}
      />
    )
  }

  if (phase === 'connecting') {
    return <p className="p-8 text-neutral-600">Connecting you to the recruiter…</p>
  }

  return <LiveCall turns={turns} onEnd={() => void end()} />
}
```

- [ ] **Step 6: Переписать главную страницу**

`src/app/page.tsx`:

```tsx
import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-3xl font-semibold">Unimatch screening</h1>
      <p className="text-neutral-600">
        A ten-minute first-round call in English, run by our AI assistant. You will need a microphone
        and a quiet room. A human recruiter reads the result and decides what happens next.
      </p>
      <Link href="/interview" className="inline-block rounded bg-black px-5 py-2.5 text-white">
        Start the interview
      </Link>
      <p className="pt-8 text-sm text-neutral-500">
        Recruiters: <Link href="/dashboard" className="underline">open the dashboard</Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 7: Прогнать интервью живьём**

Run: `npm run dev`, пройти `/interview` целиком: согласие → микрофон → разговор минимум на два вопроса → «End the interview».

Проверить: агент говорит первым, транскрипт растёт в реальном времени, в базе `transcript` не пустой, статус после завершения `analyzing`.

- [ ] **Step 8: Задеплоить и повторить на проде**

```bash
npx vercel@latest --prod
```

Пройти то же самое на боевом URL. Проверить в Blob, что чанки появились (локально `onUploadCompleted` не срабатывает, на проде должен).

- [ ] **Step 9: Коммит**

```bash
git add -A
git commit -m "feat: кандидатский флоу — согласие, микрофон, разговор, спасибо"
```

---

### Task 12: Нейтральные метрики

**Files:**
- Create: `src/lib/metrics.ts`
- Create: `tests/metrics.test.ts`

**Interfaces:**
- Consumes: `Turn`, `Metrics` из `@/lib/types`
- Produces: `computeMetrics(turns: Turn[]): Metrics`; `hasEnoughSpeech(metrics: Metrics): boolean`; константы `MIN_CANDIDATE_SPEECH_SEC = 60`, `MIN_CANDIDATE_TURNS = 3`

- [ ] **Step 1: Написать падающий тест**

`tests/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeMetrics, hasEnoughSpeech } from '@/lib/metrics'
import type { Turn } from '@/lib/types'

const t = (id: string, speaker: Turn['speaker'], tStart: number, tEnd: number): Turn => ({
  id, speaker, text: 'x', tStart, tEnd, timingSource: 'server',
})

describe('computeMetrics', () => {
  it('считает длительность, доли речи и паузы перед ответами', () => {
    const m = computeMetrics([
      t('a1', 'agent', 0, 4),
      t('c1', 'candidate', 6, 16),
      t('a2', 'agent', 17, 19),
      t('c2', 'candidate', 24, 34),
    ])
    expect(m.durationSec).toBe(34)
    expect(m.candidateSpeechSec).toBe(20)
    expect(m.agentSpeechSec).toBe(6)
    expect(m.candidateSharePct).toBe(77)
    expect(m.candidateTurnCount).toBe(2)
    expect(m.pauses).toEqual([
      { turnId: 'c1', pauseSec: 2 },
      { turnId: 'c2', pauseSec: 5 },
    ])
    expect(m.medianPauseSec).toBe(3.5)
    expect(m.longestPauseSec).toBe(5)
  })

  it('не считает паузу между двумя репликами кандидата', () => {
    const m = computeMetrics([t('c1', 'candidate', 0, 2), t('c2', 'candidate', 9, 10)])
    expect(m.pauses).toEqual([])
  })

  it('не даёт отрицательных пауз при перебивании', () => {
    const m = computeMetrics([t('a1', 'agent', 0, 5), t('c1', 'candidate', 4, 8)])
    expect(m.pauses).toEqual([{ turnId: 'c1', pauseSec: 0 }])
  })

  it('переживает пустой транскрипт', () => {
    const m = computeMetrics([])
    expect(m).toMatchObject({ durationSec: 0, candidateSharePct: 0, medianPauseSec: 0, longestPauseSec: 0 })
  })
})

describe('hasEnoughSpeech', () => {
  it('хватает при трёх репликах и минуте речи', () => {
    const m = computeMetrics([
      t('c1', 'candidate', 0, 25), t('c2', 'candidate', 30, 55), t('c3', 'candidate', 60, 75),
    ])
    expect(hasEnoughSpeech(m)).toBe(true)
  })

  it('не хватает при односложных ответах', () => {
    const m = computeMetrics([
      t('c1', 'candidate', 0, 2), t('c2', 'candidate', 5, 7), t('c3', 'candidate', 9, 11),
    ])
    expect(hasEnoughSpeech(m)).toBe(false)
  })

  it('не хватает при одной длинной реплике: одного ответа мало для оценки', () => {
    const m = computeMetrics([t('c1', 'candidate', 0, 200)])
    expect(hasEnoughSpeech(m)).toBe(false)
  })

  it('не хватает при пустом разговоре', () => {
    expect(hasEnoughSpeech(computeMetrics([]))).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/metrics.test.ts`
Expected: FAIL — нет модуля `@/lib/metrics`

- [ ] **Step 3: Реализовать метрики**

`src/lib/metrics.ts`:

```ts
import type { Metrics, Pause, Turn } from './types'

const round = (n: number) => Math.round(n * 100) / 100

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Только нейтральные факты о разговоре. Темп речи здесь сознательно не считается:
 * оценка по темпу запрещена спецификацией.
 */
export function computeMetrics(turns: Turn[]): Metrics {
  const ordered = [...turns].sort((a, b) => a.tStart - b.tStart)
  const speech = (speaker: Turn['speaker']) =>
    round(ordered.filter((t) => t.speaker === speaker).reduce((sum, t) => sum + Math.max(0, t.tEnd - t.tStart), 0))

  const candidateSpeechSec = speech('candidate')
  const agentSpeechSec = speech('agent')
  const total = candidateSpeechSec + agentSpeechSec

  const pauses: Pause[] = []
  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i]
    const previous = ordered[i - 1]
    if (current.speaker !== 'candidate' || previous.speaker !== 'agent') continue
    pauses.push({ turnId: current.id, pauseSec: round(Math.max(0, current.tStart - previous.tEnd)) })
  }

  const pauseValues = pauses.map((p) => p.pauseSec)
  return {
    durationSec: ordered.length ? round(Math.max(...ordered.map((t) => t.tEnd))) : 0,
    candidateSpeechSec,
    agentSpeechSec,
    candidateSharePct: total ? Math.round((candidateSpeechSec / total) * 100) : 0,
    candidateTurnCount: ordered.filter((t) => t.speaker === 'candidate').length,
    pauses,
    medianPauseSec: median(pauseValues),
    longestPauseSec: pauseValues.length ? Math.max(...pauseValues) : 0,
  }
}

export const MIN_CANDIDATE_SPEECH_SEC = 60
export const MIN_CANDIDATE_TURNS = 3

/**
 * Порог, ниже которого оценку уровня языка и манеры речи выдавать нечестно.
 * Оба условия обязательны: одна длинная реплика — это один ответ, а не разговор.
 */
export function hasEnoughSpeech(metrics: Metrics): boolean {
  return (
    metrics.candidateSpeechSec >= MIN_CANDIDATE_SPEECH_SEC &&
    metrics.candidateTurnCount >= MIN_CANDIDATE_TURNS
  )
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/metrics.test.ts`
Expected: PASS, 8 тестов

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat: нейтральные метрики разговора и порог достаточности речи"
```

---

### Task 13: Валидация цитат

Ядро задачи: утверждение без подтверждённой цитаты в карточку не попадает.

**Files:**
- Create: `src/lib/evidence.ts`
- Create: `tests/evidence.test.ts`

**Interfaces:**
- Consumes: `Evidence`, `Turn` из `@/lib/types`
- Produces:
  - `normalize(text: string): string`
  - `validateEvidence(evidence: Evidence[], turns: Turn[]): Evidence[]` — оставляет только подтверждённые
  - `keepSupported<T extends { evidence: Evidence[] }>(items: T[], turns: Turn[]): { kept: T[]; dropped: number }`

- [ ] **Step 1: Написать падающий тест**

`tests/evidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { keepSupported, normalize, validateEvidence } from '@/lib/evidence'
import type { Turn } from '@/lib/types'

const turns: Turn[] = [
  { id: 'c1', speaker: 'candidate', text: "I led a team of six, and we shipped it in April.", tStart: 1, tEnd: 5, timingSource: 'server' },
  { id: 'a1', speaker: 'agent', text: 'Where are you based?', tStart: 0, tEnd: 1, timingSource: 'client' },
]

describe('normalize', () => {
  it('снимает регистр, пунктуацию и лишние пробелы', () => {
    expect(normalize('  I led a TEAM, of six! ')).toBe('i led a team of six')
  })
})

describe('validateEvidence', () => {
  it('оставляет цитату, входящую в реплику кандидата', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'led a team of six' }], turns)).toHaveLength(1)
  })

  it('пропускает цитату с другой пунктуацией и регистром', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'Led a team of six!' }], turns)).toHaveLength(1)
  })

  it('выбрасывает выдуманную цитату', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: 'I managed twenty people' }], turns)).toEqual([])
  })

  it('выбрасывает ссылку на несуществующую реплику', () => {
    expect(validateEvidence([{ turnId: 'nope', quote: 'led a team' }], turns)).toEqual([])
  })

  it('выбрасывает ссылку на реплику агента: оцениваем кандидата, не агента', () => {
    expect(validateEvidence([{ turnId: 'a1', quote: 'Where are you based' }], turns)).toEqual([])
  })

  it('выбрасывает пустую цитату', () => {
    expect(validateEvidence([{ turnId: 'c1', quote: '   ' }], turns)).toEqual([])
  })
})

describe('keepSupported', () => {
  it('оставляет только утверждения с подтверждённой опорой и считает выброшенные', () => {
    const result = keepSupported(
      [
        { label: 'ok', evidence: [{ turnId: 'c1', quote: 'shipped it in April' }] },
        { label: 'fabricated', evidence: [{ turnId: 'c1', quote: 'I have a PhD' }] },
        { label: 'bare', evidence: [] },
      ],
      turns,
    )
    expect(result.kept.map((k) => k.label)).toEqual(['ok'])
    expect(result.dropped).toBe(2)
  })

  it('чистит частично выдуманный набор цитат, сохраняя утверждение', () => {
    const result = keepSupported(
      [{ label: 'mixed', evidence: [{ turnId: 'c1', quote: 'led a team of six' }, { turnId: 'c1', quote: 'I have a PhD' }] }],
      turns,
    )
    expect(result.kept[0].evidence).toHaveLength(1)
    expect(result.dropped).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/evidence.test.ts`
Expected: FAIL — нет модуля `@/lib/evidence`

- [ ] **Step 3: Реализовать валидацию**

`src/lib/evidence.ts`:

```ts
import type { Evidence, Turn } from './types'

/** Сравниваем по сути, а не по форме: ASR и модель по-разному ставят пунктуацию и регистр. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Цитата подтверждена, только если её текст действительно есть в указанной реплике кандидата.
 * Реплики агента опорой быть не могут: оценивается кандидат.
 */
export function validateEvidence(evidence: Evidence[], turns: Turn[]): Evidence[] {
  const candidateText = new Map(
    turns.filter((t) => t.speaker === 'candidate').map((t) => [t.id, normalize(t.text)]),
  )
  return evidence.filter((e) => {
    const quote = normalize(e.quote ?? '')
    if (!quote) return false
    const source = candidateText.get(e.turnId)
    return !!source && source.includes(quote)
  })
}

export function keepSupported<T extends { evidence: Evidence[] }>(items: T[], turns: Turn[]) {
  const kept: T[] = []
  let dropped = 0
  for (const item of items) {
    const evidence = validateEvidence(item.evidence ?? [], turns)
    if (evidence.length === 0) {
      dropped++
      continue
    }
    kept.push({ ...item, evidence })
  }
  return { kept, dropped }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/evidence.test.ts`
Expected: PASS, 9 тестов

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "feat: валидация цитат — утверждение без опоры выбрасывается"
```

---

### Task 14: Схемы и промпты анализа

**Files:**
- Create: `src/lib/analyze/schemas.ts`
- Create: `src/lib/analyze/prompts.ts`
- Create: `tests/analyze-prompts.test.ts`

**Interfaces:**
- Consumes: `RoleConfig` из `@/lib/roles`; `Metrics`, `Turn` из `@/lib/types`
- Produces:
  - `StructureResult`, `LanguageResult`, `DeliveryResult`, `FactsResult` — Zod-схемы для `zodTextFormat`
  - `renderTranscript(turns: Turn[]): string`
  - `structurePrompt(role: RoleConfig, transcript: string): string`
  - `languagePrompt(transcript: string): string`
  - `deliveryPrompt(transcript: string, metrics: Metrics): string`

- [ ] **Step 1: Определить, какая модель доступна для анализа**

```bash
node --env-file=.env.local -e "
fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY } })
  .then(r => r.json())
  .then(d => console.log(d.data.map(m => m.id).filter(id => !id.includes('realtime') && !id.includes('embed')).sort().join('\n')))
"
```

Выбрать самую сильную доступную текстовую модель с поддержкой structured outputs, вписать её id в `.env.local` и в переменные Vercel как `OPENAI_ANALYSIS_MODEL`. Записать выбор в `docs/realtime-probe-findings.md`.

- [ ] **Step 2: Написать Zod-схемы результатов анализа**

`src/lib/analyze/schemas.ts`:

```ts
import { z } from 'zod'

const evidence = z.object({
  turnId: z.string().describe('id реплики КАНДИДАТА из транскрипта'),
  quote: z.string().describe('дословный фрагмент этой реплики'),
})

/**
 * Пустой список допустим намеренно. Требование «минимум одна цитата» проверяет код:
 * схема, обязывающая приложить цитату к каждому полю, вынуждает модель выдумать её
 * там, где сказать нечего.
 */
const evidenceList = z.array(evidence)

const starElement = z.object({
  present: z.boolean(),
  note: z.string(),
  evidence: evidenceList,
})

export const StructureResult = z.object({
  summary: z.string(),
  coverage: z.array(
    z.object({
      questionId: z.string(),
      answered: z.enum(['yes', 'partial', 'off_topic']),
      note: z.string(),
      evidence: evidenceList,
    }),
  ),
  example: z.object({ situation: starElement, action: starElement, result: starElement }),
})

const band = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])

export const LanguageResult = z.object({
  summary: z.string(),
  rangeLow: band,
  rangeHigh: band,
  subscores: z.array(
    z.object({
      name: z.enum(['grammar', 'vocabulary', 'coherence']),
      band,
      note: z.string(),
      evidence: evidenceList,
    }),
  ),
})

export const DeliveryResult = z.object({
  summary: z.string(),
  signals: z.array(
    z.object({
      label: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      whatToCheck: z.string(),
      evidence: evidenceList,
    }),
  ),
})

// Нельзя `.optional()`: под strict все поля обязательны, «нет значения» выражается null.
const fact = z.object({ value: z.string().nullable(), evidence: evidenceList })

export const FactsResult = z.object({
  location: fact,
  workRight: fact,
  domainExperience: fact,
  workFormat: fact,
  startDate: fact,
})
```

- [ ] **Step 3: Написать падающий тест промптов**

`tests/analyze-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deliveryPrompt, languagePrompt, renderTranscript, structurePrompt } from '@/lib/analyze/prompts'
import { loadRole } from '@/lib/roles'
import type { Metrics, Turn } from '@/lib/types'

const turns: Turn[] = [
  { id: 'a1', speaker: 'agent', text: 'Where are you based?', tStart: 0, tEnd: 2, timingSource: 'client' },
  { id: 'c1', speaker: 'candidate', text: 'Berlin, and I can work as a contractor.', tStart: 3, tEnd: 7, timingSource: 'server' },
]

const metrics: Metrics = {
  durationSec: 7, candidateSpeechSec: 4, agentSpeechSec: 2, candidateSharePct: 67,
  candidateTurnCount: 1, pauses: [{ turnId: 'c1', pauseSec: 1 }], medianPauseSec: 1, longestPauseSec: 1,
}

describe('renderTranscript', () => {
  it('помечает реплики id и говорящим', () => {
    const text = renderTranscript(turns)
    expect(text).toContain('[c1] CANDIDATE')
    expect(text).toContain('[a1] RECRUITER')
    expect(text).toContain('Berlin')
  })
})

describe('промпты', () => {
  it('структурный промпт перечисляет вопросы роли по id', () => {
    const prompt = structurePrompt(loadRole('unimatch-default'), renderTranscript(turns))
    expect(prompt).toContain('location')
    expect(prompt).toContain('experience')
  })

  it('каждый промпт требует цитаты и запрещает дискриминационные признаки', () => {
    for (const prompt of [
      structurePrompt(loadRole('unimatch-default'), 'x'),
      languagePrompt('x'),
      deliveryPrompt('x', metrics),
    ]) {
      expect(prompt).toMatch(/evidence/i)
      expect(prompt).toMatch(/accent/i)
      expect(prompt).toMatch(/age/i)
      expect(prompt).toMatch(/gender/i)
    }
  })

  it('промпт манеры речи прямо запрещает трактовать паузу как негатив', () => {
    const prompt = deliveryPrompt('x', metrics)
    expect(prompt).toMatch(/pause/i)
    expect(prompt).toMatch(/never treat a pause/i)
  })
})
```

- [ ] **Step 4: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/analyze-prompts.test.ts`
Expected: FAIL — нет модуля `@/lib/analyze/prompts`

- [ ] **Step 5: Реализовать промпты**

`src/lib/analyze/prompts.ts`:

```ts
import type { RoleConfig } from '../roles'
import type { Metrics, Turn } from '../types'

const GROUND_RULES = `GROUND RULES — these override anything else
- Judge the FORM of the answers, never their content or the person.
- Every single claim you make must carry evidence: the id of a CANDIDATE turn and a verbatim quote from that turn. A claim you cannot quote must be left out entirely.
- Quote only from turns marked CANDIDATE. Recruiter turns are context, never evidence.
- Never comment on accent, speaking speed, tempo, voice, gender or age. These are discriminatory and legally risky.
- Never invent a quote. If the transcript does not contain the words, the claim does not exist.`

export function renderTranscript(turns: Turn[]): string {
  return turns
    .map((t) => `[${t.id}] ${t.speaker === 'agent' ? 'RECRUITER' : 'CANDIDATE'} (${t.tStart.toFixed(1)}s–${t.tEnd.toFixed(1)}s): ${t.text}`)
    .join('\n')
}

export function structurePrompt(role: RoleConfig, transcript: string): string {
  const questions = role.questions.map((q) => `- ${q.id}: ${q.ask}`).join('\n')
  return `You review how structurally a candidate answers in a screening call.

${GROUND_RULES}

THE QUESTIONS THE RECRUITER WAS SUPPOSED TO COVER
${questions}

FOR EACH QUESTION decide whether the candidate answered what was actually asked:
- "yes" — they addressed the question
- "partial" — they addressed part of it, or answered vaguely
- "off_topic" — they talked about something else

Use exactly the questionId values listed above. Skip a question entirely if it was never asked in the transcript.

THEN look at the one concrete example they gave from their own practice and judge whether these three pieces are present, each separately:
- situation: what the context or problem was
- action: what THEY personally did, not their team
- result: how it ended, ideally with something measurable

Write summary as two or three sentences a recruiter can read in ten seconds.

TRANSCRIPT
${transcript}`
}

export function languagePrompt(transcript: string): string {
  return `You assess a candidate's level of English from a screening call transcript, on the CEFR scale.

${GROUND_RULES}

Assess only what text can show: grammatical range and accuracy, vocabulary precision, and coherence — how well ideas connect. Judge nothing about how they sound.

Give a RANGE (rangeLow, rangeHigh), not a single band: ten minutes of conversation does not support more precision, and a range is the honest answer. rangeLow must be lower than or equal to rangeHigh.

Give exactly three subscores: grammar, vocabulary, coherence. Each one needs quotes that actually justify the band you chose — a quote showing a complex construction handled well, or an error that caps the level.

Remember that this is a spoken transcript produced by automatic speech recognition. Do not treat missing punctuation or ASR artefacts as the candidate's mistakes.

Write summary as two or three sentences explaining what puts them in this range.

TRANSCRIPT
${transcript}`
}

export function deliveryPrompt(transcript: string, metrics: Metrics): string {
  const pauses = metrics.pauses.map((p) => `${p.turnId}: ${p.pauseSec}s`).join(', ') || 'none recorded'
  return `You help a recruiter notice whether a candidate was speaking freely or delivering something prepared in advance.

${GROUND_RULES}

You are NOT deciding anything. You surface signals worth listening to, each with a confidence level and a concrete "what to check" note for the recruiter.

Signals that a passage may be read or pre-written rather than spoken:
- written syntax with no spoken hesitation markers at all, in an otherwise hesitant conversation
- an abrupt shift in register or fluency between one answer and the next
- an answer that does not quite match the question that was asked, arriving after a long silence
- polished stock phrasing in a place where a spoken answer would be specific

CRITICAL: never treat a pause as a negative signal in itself. A thoughtful introvert and someone reading from a script both produce silence, and the difference is not the length of the pause. Only mention silence when it is paired with another signal, such as a register shift right after it.

If you see nothing worth flagging, return an empty signals array and say so in the summary. That is a perfectly good outcome, and much better than inventing a concern.

NEUTRAL FACTS measured from the audio, given as context only — not as findings:
- conversation length: ${metrics.durationSec}s, candidate spoke ${metrics.candidateSharePct}% of the speaking time
- silence before each candidate answer: ${pauses}

TRANSCRIPT
${transcript}`
}

export function factsPrompt(transcript: string): string {
  return `Extract the concrete facts the recruiter needs from a screening call transcript.

${GROUND_RULES}

Extract five fields: location, workRight (whether they are legally allowed to work from there), domainExperience (their relevant experience in one short line), workFormat (what setup they want), startDate (when they could start).

Set value to null when the transcript does not answer it. Do not guess, do not infer from their accent or name, and do not fill a gap with something plausible. A null with no evidence is the correct answer for a question that was never answered.

TRANSCRIPT
${transcript}`
}
```

- [ ] **Step 6: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/analyze-prompts.test.ts`
Expected: PASS, 4 теста

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: схемы и промпты анализа с запретами и требованием цитат"
```

---

### Task 15: Оркестрация анализа

**Files:**
- Create: `src/lib/analyze/index.ts`
- Create: `tests/analyze.test.ts`
- Create: `tests/fixtures/transcripts.ts`

**Interfaces:**
- Consumes: схемы и промпты из `@/lib/analyze/*`; `keepSupported`, `validateEvidence` из `@/lib/evidence`; `computeMetrics` из `@/lib/metrics`; `loadRole` из `@/lib/roles`
- Produces: `buildCard(input: { turns: Turn[]; roleId: string }): Promise<{ card: Card; metrics: Metrics }>`

- [ ] **Step 1: Написать фикстуры транскриптов**

Длительности реплик подобраны так, чтобы три первые фикстуры проходили порог
достаточности (от 60 секунд речи и от 3 реплик), а четвёртая — намеренно нет.

`tests/fixtures/transcripts.ts`:

```ts
import type { Turn } from '@/lib/types'

const turn = (id: string, speaker: Turn['speaker'], text: string, tStart: number, tEnd: number): Turn => ({
  id, speaker, text, tStart, tEnd, timingSource: speaker === 'candidate' ? 'server' : 'client',
})

/** Структурный кандидат: отвечает по существу, в примере есть ситуация, действие и результат. */
export const strongCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based, and can you work as a contractor?', 0, 4),
  turn('c1', 'candidate', 'I am based in Lisbon, and yes, I have been invoicing as a contractor for three years, so the paperwork side is familiar to me.', 5, 14),
  turn('a2', 'agent', 'Tell me about your experience with students, then one specific case.', 15, 19),
  turn('c2', 'candidate', 'I spent two years at an education agency handling applications end to end. One student had been rejected twice and came to me in June with a September deadline. I rebuilt her list around three programmes that actually matched her grades, rewrote her personal statement with her over four sessions, and chased the referee who was holding things up. She was admitted in August, and she started that autumn.', 21, 72),
  turn('a3', 'agent', 'What working setup are you looking for?', 73, 76),
  turn('c3', 'candidate', 'Full time and fully remote suits me best. I have worked across time zones before, so overlapping a few hours a day is something I am used to organising.', 77, 89),
  turn('a4', 'agent', 'When could you start?', 90, 92),
  turn('c4', 'candidate', 'Three weeks from now, because I need to wrap up my current contract properly and hand over my caseload.', 93, 101),
]

/** Слабая структура: уходит от вопроса, говорит много, но в примере нет ни действия, ни результата. */
export const weakCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based, and can you work as a contractor?', 0, 4),
  turn('c1', 'candidate', 'I am very interested in this role, it is exactly what I am looking for right now, and I think the company is doing really meaningful work in education.', 5, 17),
  turn('a2', 'agent', 'Sure — but where are you based?', 18, 21),
  turn('c2', 'candidate', 'In Europe, more or less, it depends on the season really.', 22, 28),
  turn('a3', 'agent', 'Tell me about a specific case you handled.', 29, 32),
  turn('c3', 'candidate', 'We did a lot of work with students, the team was really good and everyone was happy with the results. There were a lot of applications and we handled them together, and the feedback was positive overall, which was nice to see for everyone involved.', 34, 66),
  turn('a4', 'agent', 'What did you personally do in that case?', 67, 70),
  turn('c4', 'candidate', 'Mostly supporting the process, whatever was needed at the time, so a bit of everything really depending on what came up that week.', 71, 88),
]

/** Похоже на зачитанное: письменный синтаксис в одном ответе, живая речь с запинками в остальных. */
export const readingCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based?', 0, 3),
  turn('c1', 'candidate', 'Um, yeah, so, I am in, uh, Warsaw right now, I moved here like, two years ago I think.', 4, 12),
  turn('a2', 'agent', 'Tell me about a specific case you handled.', 13, 16),
  turn('c2', 'candidate', 'Throughout my professional tenure I have consistently demonstrated an unwavering commitment to facilitating optimal outcomes for stakeholders, leveraging a comprehensive skill set encompassing strategic communication, meticulous attention to detail, and a proactive approach to problem resolution, thereby ensuring the successful realisation of institutional objectives across a diverse portfolio of applicants.', 24, 66),
  turn('a3', 'agent', 'And what was the result in that particular case?', 67, 70),
  turn('c3', 'candidate', 'Uh, the result, um, it was, yeah, it was good I think, like, they were happy with it, uh, I do not remember the exact numbers to be honest.', 78, 94),
]

/** Ниже порога достаточности: односложные ответы. Оценка языка и манеры выдаваться не должна. */
export const oneWordCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based?', 0, 3),
  turn('c1', 'candidate', 'Berlin.', 4, 5),
  turn('a2', 'agent', 'Can you work as a contractor there?', 6, 9),
  turn('c2', 'candidate', 'Yes.', 10, 11),
  turn('a3', 'agent', 'Tell me about a case you handled.', 12, 15),
  turn('c3', 'candidate', 'Many cases.', 16, 18),
]
```

- [ ] **Step 2: Написать падающий тест**

`tests/analyze.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { oneWordCandidate, strongCandidate } from './fixtures/transcripts'

const parse = vi.fn()
vi.mock('openai', () => ({
  default: class {
    responses = { parse }
  },
}))
vi.mock('openai/helpers/zod', () => ({ zodTextFormat: (_s: unknown, name: string) => ({ type: 'json_schema', name }) }))

const parsed = (output_parsed: unknown) => ({ output_parsed })

const structure = {
  summary: 'Answers what is asked.',
  coverage: [{ questionId: 'location', answered: 'yes', note: 'Named the city.', evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }] }],
  example: {
    situation: { present: true, note: 'Rejected twice, tight deadline.', evidence: [{ turnId: 'c2', quote: 'had been rejected twice' }] },
    action: { present: true, note: 'Rebuilt the list herself.', evidence: [{ turnId: 'c2', quote: 'I rebuilt her list' }] },
    result: { present: true, note: 'Admitted in August.', evidence: [{ turnId: 'c2', quote: 'She was admitted in August' }] },
  },
}

const language = {
  summary: 'Comfortable, complex sentences.',
  rangeLow: 'B2', rangeHigh: 'C1',
  subscores: [
    { name: 'grammar', band: 'C1', note: 'Past perfect used correctly.', evidence: [{ turnId: 'c2', quote: 'had been rejected twice' }] },
    { name: 'vocabulary', band: 'B2', note: 'Domain words are precise.', evidence: [{ turnId: 'c2', quote: 'rewrote her personal statement' }] },
    { name: 'coherence', band: 'C1', note: 'Narrates in order.', evidence: [{ turnId: 'c2', quote: 'came to me in June' }] },
  ],
}

const delivery = { summary: 'Nothing worth flagging.', signals: [] }
const facts = {
  location: { value: 'Lisbon', evidence: [{ turnId: 'c1', quote: 'I am based in Lisbon' }] },
  workRight: { value: 'Contractor for three years', evidence: [{ turnId: 'c1', quote: 'invoicing as a contractor' }] },
  domainExperience: { value: 'Two years at an education agency', evidence: [{ turnId: 'c2', quote: 'two years at an education agency' }] },
  workFormat: { value: 'Full time, remote', evidence: [{ turnId: 'c3', quote: 'Full time and fully remote' }] },
  startDate: { value: 'In three weeks', evidence: [{ turnId: 'c4', quote: 'Three weeks from now' }] },
}

/** Порядок вызовов в buildCard: структура, язык, манера, факты. */
function mockAll(overrides: Partial<Record<'structure' | 'language' | 'delivery' | 'facts', unknown>> = {}) {
  parse.mockReset()
  parse
    .mockResolvedValueOnce(parsed(overrides.structure ?? structure))
    .mockResolvedValueOnce(parsed(overrides.language ?? language))
    .mockResolvedValueOnce(parsed(overrides.delivery ?? delivery))
    .mockResolvedValueOnce(parsed(overrides.facts ?? facts))
}

beforeEach(() => {
  process.env.OPENAI_ANALYSIS_MODEL = 'test-model'
  mockAll()
})

describe('buildCard', () => {
  it('собирает карточку и считает метрики', async () => {
    const { buildCard } = await import('@/lib/analyze')
    const { card, metrics } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })

    expect(card.language).toMatchObject({ rangeLow: 'B2', rangeHigh: 'C1' })
    expect(card.structure.coverage).toHaveLength(1)
    expect(card.structure.coverage[0].questionLabel).toBe('Локация и право на работу')
    expect(card.facts.location.value).toBe('Lisbon')
    expect(metrics.candidateTurnCount).toBe(4)
    expect(parse).toHaveBeenCalledTimes(4)
  })

  it('выбрасывает выдуманные цитаты и считает выброшенное', async () => {
    mockAll({
      structure: {
        ...structure,
        coverage: [{ questionId: 'location', answered: 'yes', note: 'x', evidence: [{ turnId: 'c1', quote: 'I have a PhD from Oxford' }] }],
      },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })
    expect(card.structure.coverage).toHaveLength(0)
    expect(card.droppedClaims).toBeGreaterThan(0)
  })

  it('обнуляет факт, чья цитата не подтвердилась', async () => {
    mockAll({
      facts: { ...facts, startDate: { value: 'Tomorrow', evidence: [{ turnId: 'c4', quote: 'I can start tomorrow' }] } },
    })
    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: strongCandidate, roleId: 'unimatch-default' })
    expect(card.facts.startDate).toEqual({ value: null, evidence: [] })
  })

  it('не оценивает язык и манеру при односложных ответах и не тратит на это вызовы', async () => {
    parse.mockReset()
    parse
      .mockResolvedValueOnce(parsed({ ...structure, coverage: [] }))
      .mockResolvedValueOnce(parsed({ location: facts.location, workRight: facts.workRight, domainExperience: { value: null, evidence: [] }, workFormat: { value: null, evidence: [] }, startDate: { value: null, evidence: [] } }))

    const { buildCard } = await import('@/lib/analyze')
    const { card } = await buildCard({ turns: oneWordCandidate, roleId: 'unimatch-default' })

    expect(card.language).toMatchObject({ insufficient: true })
    expect(card.delivery).toMatchObject({ insufficient: true })
    expect((card.language as { reason: string }).reason).toMatch(/60/)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('отказывается анализировать разговор без реплик кандидата', async () => {
    const { buildCard } = await import('@/lib/analyze')
    await expect(
      buildCard({ turns: [{ id: 'a1', speaker: 'agent', text: 'hi', tStart: 0, tEnd: 1, timingSource: 'client' }], roleId: 'unimatch-default' }),
    ).rejects.toThrow(/candidate/i)
  })
})
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/analyze.test.ts`
Expected: FAIL — нет модуля `@/lib/analyze`

- [ ] **Step 4: Реализовать оркестрацию**

`src/lib/analyze/index.ts`:

```ts
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'
import { keepSupported, validateEvidence } from '../evidence'
import { computeMetrics, hasEnoughSpeech, MIN_CANDIDATE_SPEECH_SEC, MIN_CANDIDATE_TURNS } from '../metrics'
import { loadRole } from '../roles'
import type { Card, Facts, Metrics, Turn } from '../types'
import { deliveryPrompt, factsPrompt, languagePrompt, renderTranscript, structurePrompt } from './prompts'
import { DeliveryResult, FactsResult, LanguageResult, StructureResult } from './schemas'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function ask<T>(prompt: string, schema: z.ZodType<T>, name: string): Promise<T> {
  const res = await client.responses.parse({
    model: process.env.OPENAI_ANALYSIS_MODEL!,
    input: prompt,
    text: { format: zodTextFormat(schema, name) },
  })
  if (!res.output_parsed) throw new Error(`Analysis returned no parsed output for ${name}`)
  return res.output_parsed
}

export async function buildCard(input: { turns: Turn[]; roleId: string }): Promise<{ card: Card; metrics: Metrics }> {
  const { turns } = input
  if (!turns.some((t) => t.speaker === 'candidate')) {
    throw new Error('No candidate turns in this conversation — nothing to analyse')
  }

  const role = loadRole(input.roleId)
  const metrics = computeMetrics(turns)
  const transcript = renderTranscript(turns)

  // Уровень языка и манеру речи по сорока секундам речи оценивать нечестно, поэтому
  // при нехватке данных эти два вызова просто не делаются — экономим и деньги, и обман.
  const enough = hasEnoughSpeech(metrics)
  const shortfall =
    `Английской речи кандидата ${Math.round(metrics.candidateSpeechSec)} с в ` +
    `${metrics.candidateTurnCount} репл.; для обоснованной оценки нужно от ` +
    `${MIN_CANDIDATE_SPEECH_SEC} с и от ${MIN_CANDIDATE_TURNS} реплик.`

  const [rawStructure, rawLanguage, rawDelivery, rawFacts] = await Promise.all([
    ask(structurePrompt(role, transcript), StructureResult, 'structure_analysis'),
    enough ? ask(languagePrompt(transcript), LanguageResult, 'language_analysis') : null,
    enough ? ask(deliveryPrompt(transcript, metrics), DeliveryResult, 'delivery_analysis') : null,
    ask(factsPrompt(transcript), FactsResult, 'facts_extraction'),
  ])

  let dropped = 0

  const labelOf = (questionId: string) => role.questions.find((q) => q.id === questionId)?.label ?? questionId

  const coverage = keepSupported(rawStructure.coverage, turns)
  dropped += coverage.dropped

  const star = (element: { present: boolean; note: string; evidence: { turnId: string; quote: string }[] }) => {
    const evidence = validateEvidence(element.evidence, turns)
    if (evidence.length === 0) {
      dropped++
      return { present: false, note: 'Не подтверждено цитатой из разговора.', evidence: [] }
    }
    return { ...element, evidence }
  }

  const facts = Object.fromEntries(
    (['location', 'workRight', 'domainExperience', 'workFormat', 'startDate'] as const).map((key) => {
      const fact = rawFacts[key]
      const evidence = validateEvidence(fact.evidence, turns)
      if (evidence.length === 0) {
        if (fact.value) dropped++
        return [key, { value: null, evidence: [] }]
      }
      return [key, { value: fact.value, evidence }]
    }),
  ) as Facts

  let language: Card['language'] = { insufficient: true, reason: shortfall }
  if (rawLanguage) {
    const subscores = keepSupported(rawLanguage.subscores, turns)
    dropped += subscores.dropped
    language = {
      summary: rawLanguage.summary,
      rangeLow: rawLanguage.rangeLow,
      rangeHigh: rawLanguage.rangeHigh,
      subscores: subscores.kept,
    }
  }

  let delivery: Card['delivery'] = { insufficient: true, reason: shortfall }
  if (rawDelivery) {
    const signals = keepSupported(rawDelivery.signals, turns)
    dropped += signals.dropped
    delivery = { summary: rawDelivery.summary, signals: signals.kept }
  }

  const card: Card = {
    facts,
    structure: {
      summary: rawStructure.summary,
      coverage: coverage.kept.map((c) => ({ ...c, questionLabel: labelOf(c.questionId) })),
      example: {
        situation: star(rawStructure.example.situation),
        action: star(rawStructure.example.action),
        result: star(rawStructure.example.result),
      },
    },
    language,
    delivery,
    droppedClaims: dropped,
  }

  return { card, metrics }
}
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `npx vitest run tests/analyze.test.ts`
Expected: PASS, 5 тестов

- [ ] **Step 6: Прогнать анализ на всех фикстурах живой моделью**

```bash
node --env-file=.env.local --experimental-strip-types -e "
import { buildCard } from './src/lib/analyze/index.ts'
import { strongCandidate, weakCandidate, readingCandidate, oneWordCandidate } from './tests/fixtures/transcripts.ts'
for (const [name, turns] of Object.entries({ strongCandidate, weakCandidate, readingCandidate, oneWordCandidate })) {
  const { card } = await buildCard({ turns, roleId: 'unimatch-default' })
  console.log('===', name, JSON.stringify(card, null, 2))
}
"
```

Проверить глазами, что модель не путает случаи:

| Фикстура | Что должно быть в результате |
|---|---|
| `strongCandidate` | `answered: yes`, все три элемента примера на месте, уровень языка в верхней половине шкалы |
| `weakCandidate` | `off_topic` или `partial` на локации, `present: false` у действия и результата |
| `readingCandidate` | сигнал в `delivery.signals` про смену регистра между ответами — **не** про длину паузы |
| `oneWordCandidate` | `insufficient: true` в блоках языка и манеры; ровно два вызова модели вместо четырёх |

Если путает — править промпты в задаче 14 и повторять. Это единственное место в плане,
где решает не тест, а глаза: качество промптов иначе не проверить.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: оркестрация анализа с валидацией цитат и фикстурами"
```

---

### Task 16: Роут анализа и склейка аудио

**Files:**
- Create: `src/app/api/analyze/route.ts`
- Create: `src/app/api/audio/stitch/route.ts`
- Create: `tests/analyze-route.test.ts`

**Interfaces:**
- Consumes: `buildCard` из `@/lib/analyze`; `getSession`, `saveAnalysis`, `setStatus`, `setAudioUrl` из `@/lib/db`
- Produces:
  - `POST /api/analyze` с телом `{ sessionId }` → `{ ok: true }`; идемпотентен
  - `POST /api/audio/stitch` с телом `{ sessionId }` → `{ audioUrl }`

- [ ] **Step 1: Написать падающий тест роута анализа**

`tests/analyze-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const saveAnalysis = vi.fn(async () => {})
const setStatus = vi.fn(async () => {})
const buildCard = vi.fn(async () => ({ card: { droppedClaims: 0 }, metrics: { durationSec: 1 } }))

vi.mock('@/lib/db', () => ({ getSession, saveAnalysis, setStatus }))
vi.mock('@/lib/analyze', () => ({ buildCard }))

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/analyze/route')
  return POST(new Request('http://x/api/analyze', { method: 'POST', body: JSON.stringify(body) }))
}

const session = { id: 's1', roleId: 'unimatch-default', status: 'analyzing', card: null, transcript: [{ id: 'c1', speaker: 'candidate' }] }

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue(session)
})

describe('POST /api/analyze', () => {
  it('анализирует и сохраняет карточку', async () => {
    const res = await post({ sessionId: 's1' })
    expect(res.status).toBe(200)
    expect(setStatus).toHaveBeenCalledWith('s1', 'analyzing')
    expect(saveAnalysis).toHaveBeenCalled()
  })

  it('идемпотентен: повторный анализ перезаписывает результат', async () => {
    getSession.mockResolvedValue({ ...session, status: 'analyzed', card: { droppedClaims: 0 } })
    const res = await post({ sessionId: 's1' })
    expect(res.status).toBe(200)
    expect(buildCard).toHaveBeenCalledTimes(1)
  })

  it('404 на неизвестной сессии', async () => {
    getSession.mockResolvedValue(null)
    expect((await post({ sessionId: 'nope' })).status).toBe(404)
  })

  it('ставит статус failed, когда анализ упал', async () => {
    buildCard.mockRejectedValueOnce(new Error('model exploded') as never)
    const res = await post({ sessionId: 's1' })
    expect(res.status).toBe(500)
    expect(setStatus).toHaveBeenCalledWith('s1', 'failed')
  })

  it('400 на разговоре без реплик кандидата', async () => {
    getSession.mockResolvedValue({ ...session, transcript: [] })
    expect((await post({ sessionId: 's1' })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/analyze-route.test.ts`
Expected: FAIL — нет модуля роута

- [ ] **Step 3: Реализовать роут анализа**

`src/app/api/analyze/route.ts`:

```ts
import { buildCard } from '@/lib/analyze'
import { getSession, saveAnalysis, setStatus } from '@/lib/db'

export const maxDuration = 120

export async function POST(req: Request) {
  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).sessionId
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  const session = await getSession(sessionId)
  if (!session) return Response.json({ error: 'Unknown session' }, { status: 404 })

  if (!session.transcript.some((t) => t.speaker === 'candidate')) {
    await setStatus(sessionId, 'failed')
    return Response.json({ error: 'This conversation has no candidate speech to analyse' }, { status: 400 })
  }

  await setStatus(sessionId, 'analyzing')
  try {
    const { card, metrics } = await buildCard({ turns: session.transcript, roleId: session.roleId })
    await saveAnalysis(sessionId, metrics, card)
    return Response.json({ ok: true, droppedClaims: card.droppedClaims })
  } catch (err) {
    console.error('analysis failed', sessionId, err)
    await setStatus(sessionId, 'failed')
    return Response.json({ error: 'Analysis failed. You can retry it from the card.' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Реализовать склейку аудио**

`src/app/api/audio/stitch/route.ts`:

```ts
import { put } from '@vercel/blob'
import { getSession, setAudioUrl } from '@/lib/db'

export const maxDuration = 120

/** Чанки MediaRecorder не самостоятельные файлы: заголовок только в первом, склейка даёт валидный файл. */
export async function POST(req: Request) {
  let sessionId: string | undefined
  try {
    sessionId = (await req.json()).sessionId
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }
  if (!sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 })

  const session = await getSession(sessionId)
  if (!session) return Response.json({ error: 'Unknown session' }, { status: 404 })
  if (session.audioUrl) return Response.json({ audioUrl: session.audioUrl })
  if (session.audioChunks.length === 0) return Response.json({ error: 'No audio recorded' }, { status: 404 })

  const ordered = [...session.audioChunks].sort()
  const parts: ArrayBuffer[] = []
  for (const url of ordered) {
    const res = await fetch(url)
    if (!res.ok) {
      console.error('chunk fetch failed', url, res.status)
      continue
    }
    parts.push(await res.arrayBuffer())
  }
  if (parts.length === 0) return Response.json({ error: 'No readable audio chunks' }, { status: 404 })

  const blob = await put(`interviews/${sessionId}/full.webm`, new Blob(parts, { type: 'audio/webm' }), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'audio/webm',
  })
  await setAudioUrl(sessionId, blob.url)
  return Response.json({ audioUrl: blob.url })
}
```

- [ ] **Step 5: Вызывать склейку при завершении интервью**

В `src/hooks/useInterview.ts` в функции `end`, сразу после `persist(true, status)` и до вызова `/api/analyze`, добавить:

```ts
      fetch('/api/audio/stitch', {
        method: 'POST',
        body: JSON.stringify({ sessionId: id }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {})
```

Склейка вызывается и для прерванных сессий тоже — запись у них есть, просто короче. Поэтому вызов ставится **до** проверки `status !== 'interrupted'`.

- [ ] **Step 6: Запустить тесты, убедиться что проходят**

Run: `npm run test`
Expected: PASS, все файлы

- [ ] **Step 7: Прогнать целиком на проде**

```bash
npx vercel@latest --prod
```

Пройти интервью на боевом URL до конца. Проверить в базе: `status = 'analyzed'`, `card` не пустой, `audio_url` заполнен.

- [ ] **Step 8: Коммит**

```bash
git add -A
git commit -m "feat: роут анализа и склейка аудио-чанков"
```

---

### Task 17: Карточка рекрутера

**Files:**
- Create: `src/components/card/EvidenceQuote.tsx`
- Create: `src/components/card/CardSections.tsx`
- Create: `src/app/card/[id]/page.tsx`
- Create: `src/app/api/sessions/route.ts`

**Interfaces:**
- Consumes: `getSession`, `listSessions` из `@/lib/db`; типы карточки из `@/lib/types`
- Produces: `/card/[id]` на русском с кликабельными цитатами; `GET /api/sessions` → список сессий

- [ ] **Step 1: Реализовать цитату с воспроизведением фрагмента**

`src/components/card/EvidenceQuote.tsx`:

```tsx
'use client'
import { useRef, useState } from 'react'
import type { Evidence, Turn } from '@/lib/types'

const PAD = 0.4

export function EvidenceQuote({
  evidence,
  turns,
  audioUrl,
}: {
  evidence: Evidence
  turns: Turn[]
  audioUrl: string | null
}) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const turn = turns.find((t) => t.id === evidence.turnId)

  function play() {
    if (!audioUrl || !turn) return
    if (!audio.current) audio.current = new Audio(audioUrl)
    const el = audio.current
    const stopAt = turn.tEnd + PAD
    const onTime = () => {
      if (el.currentTime >= stopAt) {
        el.pause()
        el.removeEventListener('timeupdate', onTime)
        setPlaying(false)
      }
    }
    el.currentTime = Math.max(0, turn.tStart - PAD)
    el.addEventListener('timeupdate', onTime)
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  return (
    <button
      onClick={play}
      disabled={!audioUrl || !turn}
      title={audioUrl ? 'Прослушать этот фрагмент' : 'Запись недоступна'}
      className="group block w-full rounded border-l-2 border-neutral-300 bg-neutral-50 px-3 py-2 text-left text-sm hover:border-black disabled:cursor-default disabled:opacity-60"
    >
      <span className="italic">«{evidence.quote}»</span>
      {turn && (
        <span className="ml-2 whitespace-nowrap text-xs text-neutral-500">
          {playing ? '▶ играет' : `${turn.tStart.toFixed(1)}с`}
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Реализовать блоки карточки**

`src/components/card/CardSections.tsx`:

```tsx
import type { Card, Evidence, Turn } from '@/lib/types'
import { EvidenceQuote } from './EvidenceQuote'

type Ctx = { turns: Turn[]; audioUrl: string | null }

function Quotes({ evidence, ctx }: { evidence: Evidence[]; ctx: Ctx }) {
  return (
    <div className="mt-2 space-y-1.5">
      {evidence.map((e, i) => (
        <EvidenceQuote key={i} evidence={e} turns={ctx.turns} audioUrl={ctx.audioUrl} />
      ))}
    </div>
  )
}

function Block({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

const ANSWERED: Record<string, string> = {
  yes: 'Ответил на вопрос',
  partial: 'Ответил частично',
  off_topic: 'Ушёл в сторону',
}

export function FactsBlock({ card, ctx }: { card: Card; ctx: Ctx }) {
  const rows: [string, keyof Card['facts']][] = [
    ['Локация', 'location'],
    ['Право на работу', 'workRight'],
    ['Опыт в домене', 'domainExperience'],
    ['Формат работы', 'workFormat'],
    ['Срок выхода', 'startDate'],
  ]
  return (
    <Block title="Собранные факты">
      {rows.map(([label, key]) => {
        const fact = card.facts[key]
        return (
          <div key={key}>
            <div className="flex gap-2 text-sm">
              <span className="w-40 shrink-0 text-neutral-500">{label}</span>
              <span className={fact.value ? 'font-medium' : 'text-neutral-400'}>
                {fact.value ?? 'не прозвучало в разговоре'}
              </span>
            </div>
            <Quotes evidence={fact.evidence} ctx={ctx} />
          </div>
        )
      })}
    </Block>
  )
}

export function StructureBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  const star: [string, keyof Card['structure']['example']][] = [
    ['Ситуация', 'situation'],
    ['Что сделал сам', 'action'],
    ['Результат', 'result'],
  ]
  return (
    <Block title="Насколько структурно говорит" subtitle={card.structure.summary}>
      <div className="space-y-4">
        {card.structure.coverage.map((c) => (
          <div key={c.questionId}>
            <div className="text-sm">
              <span className="font-medium">{c.questionLabel}</span>
              <span className="ml-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">{ANSWERED[c.answered] ?? c.answered}</span>
            </div>
            <p className="mt-1 text-sm text-neutral-600">{c.note}</p>
            <Quotes evidence={c.evidence} ctx={ctx} />
          </div>
        ))}
      </div>
      <div className="rounded bg-neutral-50 p-4">
        <h3 className="text-sm font-semibold">Пример из практики: ситуация → действие → результат</h3>
        {star.map(([label, key]) => {
          const element = card.structure.example[key]
          return (
            <div key={key} className="mt-3">
              <div className="text-sm">
                <span className={element.present ? 'text-green-700' : 'text-neutral-400'}>
                  {element.present ? '✓' : '—'}
                </span>{' '}
                <span className="font-medium">{label}</span>
                <span className="ml-2 text-neutral-600">{element.note}</span>
              </div>
              <Quotes evidence={element.evidence} ctx={ctx} />
            </div>
          )
        })}
      </div>
    </Block>
  )
}

const SUBSCORE: Record<string, string> = { grammar: 'Грамматика', vocabulary: 'Словарь', coherence: 'Связность' }

export function LanguageBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  return (
    <Block
      title={`Уровень английского: ${card.language.rangeLow}–${card.language.rangeHigh}`}
      subtitle={card.language.summary}
    >
      {card.language.subscores.map((s) => (
        <div key={s.name}>
          <div className="text-sm">
            <span className="font-medium">{SUBSCORE[s.name] ?? s.name}</span>
            <span className="ml-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">{s.band}</span>
            <span className="ml-2 text-neutral-600">{s.note}</span>
          </div>
          <Quotes evidence={s.evidence} ctx={ctx} />
        </div>
      ))}
      <p className="text-xs text-neutral-500">
        Диапазон, а не одна буква: десять минут разговора не дают точности до подуровня.
      </p>
    </Block>
  )
}

const CONFIDENCE: Record<string, string> = { low: 'слабый сигнал', medium: 'средний сигнал', high: 'сильный сигнал' }

export function DeliveryBlockView({ card, ctx }: { card: Card; ctx: Ctx }) {
  return (
    <Block title="Как говорит" subtitle={card.delivery.summary}>
      {card.delivery.signals.length === 0 && (
        <p className="text-sm text-neutral-600">Сигналов, требующих внимания, не найдено.</p>
      )}
      {card.delivery.signals.map((s, i) => (
        <div key={i}>
          <div className="text-sm">
            <span className="font-medium">{s.label}</span>
            <span className="ml-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">{CONFIDENCE[s.confidence] ?? s.confidence}</span>
          </div>
          <p className="mt-1 text-sm text-neutral-600">На что посмотреть: {s.whatToCheck}</p>
          <Quotes evidence={s.evidence} ctx={ctx} />
        </div>
      ))}
    </Block>
  )
}

export function Disclaimer({ dropped }: { dropped: number }) {
  return (
    <section className="rounded-lg border border-dashed p-5 text-sm text-neutral-600">
      <p className="font-medium text-neutral-800">Что эта карточка не делает</p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>Не оценивает акцент, темп речи, пол и возраст.</li>
        <li>Не считает паузу негативным сигналом сама по себе.</li>
        <li>Не принимает решение по кандидату — это делает рекрутер.</li>
      </ul>
      <p className="mt-3">
        Каждое утверждение выше подкреплено цитатой из разговора; цитата кликабельна и играет
        соответствующий фрагмент записи.
        {dropped > 0 && ` Утверждений без опоры на разговор отброшено: ${dropped}.`}
      </p>
    </section>
  )
}
```

- [ ] **Step 3: Реализовать страницу карточки**

`src/app/card/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/db'
import {
  DeliveryBlockView, Disclaimer, FactsBlock, LanguageBlockView, StructureBlockView,
} from '@/components/card/CardSections'
import { RetryAnalysis } from '@/components/card/RetryAnalysis'

const STATUS: Record<string, string> = {
  live: 'Интервью идёт прямо сейчас',
  interrupted: 'Интервью было прервано',
  analyzing: 'Анализ ещё идёт',
  analyzed: 'Готово',
  failed: 'Анализ не удался',
}

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession(id)
  if (!session) notFound()

  const minutes = session.metrics ? Math.round(session.metrics.durationSec / 60) : null
  const ctx = { turns: session.transcript, audioUrl: session.audioUrl }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{session.candidateName}</h1>
        <p className="text-sm text-neutral-600">
          {session.roleId} · {new Date(session.startedAt).toLocaleString('ru-RU')}
          {minutes !== null && ` · ${minutes} мин`} · {STATUS[session.status] ?? session.status}
        </p>
        {session.status === 'interrupted' && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            Разговор прервался до конца. Карточка построена по тому, что успело прозвучать — не все
            вопросы были заданы.
          </p>
        )}
      </header>

      {!session.card ? (
        <section className="rounded-lg border p-5">
          <p className="text-sm text-neutral-700">
            {session.status === 'failed'
              ? 'Анализ упал. Данные разговора сохранены — можно попробовать снова.'
              : 'Карточка ещё не готова.'}
          </p>
          <RetryAnalysis sessionId={session.id} />
        </section>
      ) : (
        <>
          <FactsBlock card={session.card} ctx={ctx} />
          <StructureBlockView card={session.card} ctx={ctx} />
          <LanguageBlockView card={session.card} ctx={ctx} />
          <DeliveryBlockView card={session.card} ctx={ctx} />
          <Disclaimer dropped={session.card.droppedClaims} />
        </>
      )}

      {session.audioUrl && (
        <details className="rounded-lg border p-5">
          <summary className="cursor-pointer font-medium">Полная запись</summary>
          <audio controls src={session.audioUrl} className="mt-3 w-full" />
        </details>
      )}

      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer font-medium">Полный транскрипт</summary>
        <ul className="mt-3 space-y-2 text-sm">
          {session.transcript.map((t) => (
            <li key={t.id} className={t.speaker === 'agent' ? 'text-neutral-500' : ''}>
              <span className="mr-2 text-xs text-neutral-400">{t.tStart.toFixed(1)}с</span>
              <span className="mr-2 text-xs uppercase text-neutral-400">
                {t.speaker === 'agent' ? 'агент' : 'кандидат'}
              </span>
              {t.text}
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}
```

- [ ] **Step 4: Реализовать кнопку повторного анализа**

`src/components/card/RetryAnalysis.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function RetryAnalysis({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle')

  async function run() {
    setState('running')
    const res = await fetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (res.ok) location.reload()
    else setState('failed')
  }

  return (
    <div className="mt-4">
      <button onClick={run} disabled={state === 'running'} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
        {state === 'running' ? 'Анализирую…' : 'Повторить анализ'}
      </button>
      {state === 'failed' && <p className="mt-2 text-sm text-red-700">Снова не получилось. Загляни в логи Vercel.</p>}
    </div>
  )
}
```

- [ ] **Step 5: Реализовать роут списка сессий**

`src/app/api/sessions/route.ts`:

```ts
import { listSessions } from '@/lib/db'

export async function GET() {
  return Response.json({ sessions: await listSessions() })
}
```

- [ ] **Step 6: Проверить карточку живьём**

Run: `npm run dev`, открыть `/card/<id>` последней проанализированной сессии.

Проверить: блоки на русском, цитаты на английском, клик по цитате играет нужный фрагмент и останавливается, полная запись играется, транскрипт раскрывается, дисклеймер на месте.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "feat: карточка рекрутера с кликабельными аудио-цитатами"
```

---

### Task 18: Дашборд

**Files:**
- Create: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `listSessions` из `@/lib/db`
- Produces: `/dashboard` — таблица сессий со ссылками на карточки

- [ ] **Step 1: Реализовать дашборд**

`src/app/dashboard/page.tsx`:

```tsx
import Link from 'next/link'
import { listSessions } from '@/lib/db'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; className: string }> = {
  live: { label: 'идёт', className: 'bg-blue-100 text-blue-800' },
  interrupted: { label: 'прервано', className: 'bg-amber-100 text-amber-800' },
  analyzing: { label: 'анализ', className: 'bg-neutral-100 text-neutral-700' },
  analyzed: { label: 'готово', className: 'bg-green-100 text-green-800' },
  failed: { label: 'ошибка', className: 'bg-red-100 text-red-800' },
}

export default async function DashboardPage() {
  const sessions = await listSessions()

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Скрининги</h1>
        <p className="mt-1 text-sm text-neutral-600">{sessions.length} всего</p>
      </header>

      {sessions.length === 0 ? (
        <p className="text-neutral-600">
          Пока пусто. <Link href="/interview" className="underline">Пройти интервью</Link>
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2">Кандидат</th>
              <th className="py-2">Роль</th>
              <th className="py-2">Когда</th>
              <th className="py-2">Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const status = STATUS[s.status] ?? { label: s.status, className: 'bg-neutral-100' }
              return (
                <tr key={s.id} className="border-t">
                  <td className="py-2.5 font-medium">{s.candidateName}</td>
                  <td className="py-2.5 text-neutral-600">{s.roleId}</td>
                  <td className="py-2.5 text-neutral-600">{new Date(s.startedAt).toLocaleString('ru-RU')}</td>
                  <td className="py-2.5">
                    <span className={`rounded px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
                  </td>
                  <td className="py-2.5 text-right">
                    <Link href={`/card/${s.id}`} className="underline">
                      карточка
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="pt-4 text-xs text-neutral-500">
        Демо: доступ без авторизации. В продакшене этот список закрыт логином — см. DECISIONS.md.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Проверить дашборд**

Run: `npm run dev`, открыть `/dashboard` — сессии на месте, статусы верные, ссылки ведут в карточки.

- [ ] **Step 3: Коммит**

```bash
git add -A
git commit -m "feat: дашборд со списком скринингов"
```

---

### Task 19: Прогон не по счастливому пути

Приёмка пойдёт мимо счастливого пути — это заявлено прямо. Задача проверяет каждую строку таблицы сбоев из спека и починает то, что не работает.

**Files:**
- Create: `src/app/not-found.tsx`
- Modify: файлы, где обнаружатся проблемы

**Interfaces:**
- Consumes: всё построенное
- Produces: подтверждённое поведение на каждый сбой из таблицы спека

- [ ] **Step 1: Реализовать страницу 404**

`src/app/not-found.tsx`:

```tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Такой страницы нет</h1>
      <p className="text-neutral-600">
        Возможно, ссылка на карточку устарела или в адресе опечатка.
      </p>
      <Link href="/dashboard" className="underline">Открыть список скринингов</Link>
    </main>
  )
}
```

- [ ] **Step 2: Прогнать сбои на задеплоенном демо**

Каждый пункт проверяется на боевом URL, а не локально. Записать фактическое поведение:

| Проверка | Как воспроизвести | Ожидаемое |
|---|---|---|
| Нет микрофона | Запретить доступ в браузере | Понятный экран с инструкцией и кнопкой Try again, не белая страница |
| Обрыв сети | Выключить Wi-Fi на 3-й минуте | Сессия становится `interrupted`, в дашборде видна, карточка с плашкой «прервано» |
| Закрытая вкладка | Закрыть вкладку посреди разговора | Реплики за вычетом последних секунд сохранены, статус `interrupted` |
| Молчание | Не отвечать на вопрос дважды | Агент переспрашивает, потом предлагает двигаться дальше |
| Не тот язык | Ответить по-русски | Агент вежливо просит перейти на английский |
| Пустой разговор | Начать и сразу завершить | `/api/analyze` возвращает 400, карточка показывает причину, а не пустые блоки |
| Кривой id карточки | Открыть `/card/не-uuid` | 404-страница, не стектрейс |
| Нет квоты OpenAI | Подставить неверный `OPENAI_API_KEY` в preview-деплое | Ошибка на экране согласия до старта, сессия не создана |
| Повторный анализ | Нажать «Повторить анализ» на готовой карточке | Карточка перестраивается, дубликата сессии нет |

- [ ] **Step 3: Починить найденное**

Каждую расхождение с ожидаемым править на месте, с коммитом на каждую починку. Если поведение изменить дорого — записать факт в `DECISIONS.md`, а не прятать.

- [ ] **Step 4: Прогнать все тесты**

Run: `npm run test && npx tsc --noEmit && npm run build`
Expected: всё зелёное

- [ ] **Step 5: Коммит**

```bash
git add -A
git commit -m "fix: поведение на сбоях по таблице спека"
```

---

### Task 20: README и разбор решений

**Files:**
- Create: `README.md`
- Create: `DECISIONS.md`

**Interfaces:**
- Consumes: всё построенное, включая замеренную стоимость прогона
- Produces: документы сдачи

- [ ] **Step 1: Написать README**

`README.md` — структура: что это и зачем (три абзаца, с точки зрения рекрутера, а не разработчика) · демо-ссылки (`/interview`, `/dashboard`) · как это работает (схема из спека) · локальный запуск (переменные окружения из `.env.example`, `npm run db:init`, `npm run dev`, `npm run test`) · оговорка, что `onUploadCompleted` в Blob не срабатывает на localhost, поэтому чанки локально не регистрируются · ссылки на `docs/superpowers/specs/`, `DECISIONS.md`, `CUSTOMER-QUESTIONS.md`.

- [ ] **Step 2: Замерить стоимость одного прогона**

Открыть биллинг OpenAI, посмотреть расход за одно полное интервью (разделив на число прогонов за день). Цифра идёт в `DECISIONS.md` — заказчику нужна честная стоимость скрининга.

- [ ] **Step 3: Написать разбор решений**

`DECISIONS.md`, одна страница, три части:

**Что выбрал и почему** — прямое соединение браузера с Realtime вместо своего relay-сервера и вместо коробочной платформы; серверные тайминги VAD как основа доказательств; валидация цитат кодом, а не доверие модели; диапазон CEFR вместо одной буквы; манера речи как «на что посмотреть», а не вердикт; конфиг роли одним JSON-файлом.

**От чего отказался** — relay-сервер на отдельном хостинге (сроки, второй хостинг); серверный сбор транскрипта через `call_id` (живой WebSocket не укладывается в лимиты Vercel — с ценой отказа: клиент технически может подменить транскрипт); пословные тайминги (realtime-модели их не отдают); авторизация; ATS, многоязычность, автопереход кандидата.

**Где слабо** — открытый доступ к дашборду и карточкам; собранный на клиенте транскрипт; приблизительные тайминги реплик агента; CEFR по десяти минутам; «ищет ответ в другом окне» — вероятностный сигнал, за экраном кандидата мы не следим и не хотим; одна проверенная роль; стоимость прогона (замеренная цифра) и её нелинейный рост с длиной разговора.

- [ ] **Step 4: Финальная проверка перед сдачей**

Run: `npm run test && npx tsc --noEmit && npm run build && npx vercel@latest --prod`

Затем пройти на боевом URL полное интервью с нуля как кандидат и прочитать карточку как рекрутер. Это ровно то, что будет делать принимающий.

- [ ] **Step 5: Коммит и пуш**

```bash
git add -A
git commit -m "docs: README и разбор решений"
git push -u origin main
```

---

## Self-Review

**Покрытие спека.** Каждый раздел спека закрыт задачей: §3 архитектура — задачи 1, 7, 10; §3.1 контракт Realtime — задачи 2, 7, 10; §4 флоу кандидата — задачи 5, 11; §5 данные разговора — задачи 3, 6, 8; §5 стоимость — задача 20 шаг 2; §6 запись аудио — задачи 9, 16; §7 анализ — задачи 12, 13, 14, 15, 16; §8 сбои — задачи 11, 16, 19; §9 границы — задача 14 (промпты) и 17 (дисклеймер); §10 стек — задача 1; §11 модель данных — задача 4; §12 проверка — тесты в задачах 5–15 и прогоны в 19; §13 график — порядок задач; §14 артефакты — задача 20; §15 слабые места — задача 20 шаг 3.

**Заглушек нет.** Каждый шаг с кодом содержит код целиком; ни одного «аналогично задаче N», ни одного «добавить обработку ошибок» без указания какой именно.

**Согласованность типов.** `Turn`, `Metrics`, `Card`, `Evidence` определены в задаче 3 и используются дальше без переименований. `assembleTurns` (задача 6) → `/api/turns` (задача 8) → `buildCard` (задача 15) → карточка (задача 17) работают на одном и том же `Turn`. `validateEvidence`/`keepSupported` (задача 13) вызываются в задаче 15 с теми же сигнатурами. `questionLabel` в `QuestionCoverage` заполняется в задаче 15 из `role.questions[].label`, а не приходит от модели — поэтому его нет в `STRUCTURE_SCHEMA` задачи 14, и это осознанно.

**Два места, где план обязан уступить реальности.** Точное значение `turn_detection` (задача 7) берётся из результатов задачи 2, а `OPENAI_ANALYSIS_MODEL` (задача 14) — из живого списка моделей. План не угадывает эти два значения, а требует их измерить.
