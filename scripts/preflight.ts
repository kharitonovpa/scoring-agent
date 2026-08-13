/**
 * Проверяет ключ ровно теми вызовами, которые делает приложение, до того как мы
 * потратим время на живое интервью. Запуск: npm run preflight
 */

import { configureProxyFromEnv } from '../src/lib/proxy.ts'

const KEY = process.env.OPENAI_API_KEY
if (!KEY) {
  console.error('✗ OPENAI_API_KEY не задан в .env.local')
  process.exit(1)
}

await configureProxyFromEnv((m) => console.log(`· ${m}`))

const ok = (m: string) => console.log(`✓ ${m}`)
const bad = (m: string) => console.log(`✗ ${m}`)

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  return { res, body: await res.text() }
}

let failed = false

// 1. Ключ вообще живой и биллинг подключён.
{
  const { res, body } = await api('/models')
  if (!res.ok) {
    bad(`ключ не принят (${res.status}): ${body.slice(0, 300)}`)
    if (res.status === 401) console.log('  → ключ неверный или удалён')
    if (res.status === 429) console.log('  → квота исчерпана: пополни баланс на platform.openai.com/settings/organization/billing')
    process.exit(1)
  }
  ok('ключ принят')

  const ids = (JSON.parse(body).data as { id: string }[]).map((m) => m.id).sort()
  const realtime = ids.filter((id) => id.includes('realtime'))
  const transcribe = ids.filter((id) => id.includes('transcribe'))
  console.log(`  realtime-модели: ${realtime.join(', ') || 'НЕТ НИ ОДНОЙ'}`)
  console.log(`  транскрипция:    ${transcribe.join(', ') || 'НЕТ НИ ОДНОЙ'}`)

  if (!realtime.includes('gpt-realtime-2.1')) {
    bad('gpt-realtime-2.1 недоступен этому аккаунту — подставь модель из списка выше в src/app/api/session/route.ts')
    failed = true
  } else ok('gpt-realtime-2.1 доступен')

  if (!transcribe.includes('gpt-4o-transcribe')) {
    bad('gpt-4o-transcribe недоступен — подставь модель из списка выше')
    failed = true
  } else ok('gpt-4o-transcribe доступен')

  const analysis = process.env.OPENAI_ANALYSIS_MODEL
  if (!analysis) {
    bad('OPENAI_ANALYSIS_MODEL не задан в .env.local')
    console.log(`  кандидаты: ${ids.filter((id) => /^gpt-5|^o[34]/.test(id)).join(', ')}`)
    failed = true
  } else if (!ids.includes(analysis)) {
    bad(`OPENAI_ANALYSIS_MODEL="${analysis}" недоступен этому аккаунту`)
    failed = true
  } else ok(`модель анализа доступна: ${analysis}`)
}

// 2. Тот же самый вызов, что делает /api/session. Здесь падает всё, что связано
//    с доступом к Realtime и с формой запроса.
{
  const { res, body } = await api('/realtime/client_secrets', {
    method: 'POST',
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 120 },
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: 'preflight check',
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
    bad(`эфемерный ключ не выдан (${res.status}): ${body.slice(0, 400)}`)
    failed = true
  } else if (!JSON.parse(body).value) {
    bad('ответ без поля value')
    failed = true
  } else ok('эфемерный ключ выдаётся — /api/session заработает')
}

// 3. Structured outputs для анализа.
if (process.env.OPENAI_ANALYSIS_MODEL) {
  const { res, body } = await api('/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: process.env.OPENAI_ANALYSIS_MODEL,
      input: 'Reply with the JSON object {"ok": true} and nothing else.',
      text: {
        format: {
          type: 'json_schema',
          name: 'preflight',
          strict: true,
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
            additionalProperties: false,
          },
        },
      },
    }),
  })
  if (!res.ok) {
    bad(`structured output не работает (${res.status}): ${body.slice(0, 400)}`)
    failed = true
  } else ok('structured outputs работают — анализ соберётся')
}

console.log(failed ? '\nЕсть проблемы — см. выше.' : '\nВсё готово. Можно запускать интервью.')
process.exit(failed ? 1 : 0)
