/**
 * Разработка часто идёт из региона, который OpenAI не обслуживает, и тогда VPN поднимает
 * локальный прокси. `fetch` в Node переменные HTTPS_PROXY не читает — в отличие от curl,
 * из-за чего отказ выглядит как проблема с ключом, хотя ключ рабочий.
 *
 * На проде переменной нет, и весь модуль остаётся бездействующим: undici не грузится.
 */
export async function useProxyIfConfigured(log: (m: string) => void = console.log) {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (!proxy) return false

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
