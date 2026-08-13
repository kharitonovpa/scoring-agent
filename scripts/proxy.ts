/**
 * Разработка часто идёт из региона, который OpenAI не обслуживает, и тогда VPN поднимает
 * локальный прокси. `fetch` в Node переменные HTTPS_PROXY не читает — в отличие от curl,
 * из-за чего отказ выглядит как проблема с ключом, хотя ключ рабочий.
 *
 * Используется только скриптами из scripts/. В самом приложении шима нет намеренно: он
 * решал проблему одной машины разработчика, а тянул за собой продакшен-зависимость и хук
 * инструментации Next под оба рантайма. Для разработки из закрытого региона достаточно
 * TUN-режима VPN — см. README.
 */
export async function configureProxyFromEnv(log: (m: string) => void = console.log) {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (!proxy) return false

  // Переменная переживает выключение VPN, и тогда она указывает на закрытый порт. Молча
  // направить туда весь трафик — худший исход: отказы выглядят как проблема с ключом или
  // с сетью, а не как мёртвый прокси. Поэтому сначала стучимся.
  if (!(await reachable(proxy))) {
    log(`Прокси ${proxy} не отвечает — переменная устарела, иду напрямую`)
    return false
  }

  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxy))
    log(`Исходящие запросы идут через прокси ${proxy}`)
    return true
  } catch (err) {
    log(`Не получилось включить прокси ${proxy}: ${(err as Error).message}`)
    return false
  }
}

async function reachable(proxy: string): Promise<boolean> {
  let target: URL
  try {
    target = new URL(proxy)
  } catch {
    return false
  }

  const { createConnection } = await import('node:net')
  const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)

  return new Promise((resolve) => {
    const socket = createConnection({ host: target.hostname, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}
