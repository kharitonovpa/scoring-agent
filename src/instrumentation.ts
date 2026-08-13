export async function register() {
  // Импорт именно внутри условия: модуль трогает node:net, которого нет в Edge Runtime,
  // а инструментация собирается под оба рантайма. Статический импорт затянул бы его в оба.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { useProxyIfConfigured } = await import('@/lib/proxy')
  await useProxyIfConfigured()
}
