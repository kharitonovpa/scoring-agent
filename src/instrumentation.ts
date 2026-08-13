import { useProxyIfConfigured } from '@/lib/proxy'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  await useProxyIfConfigured()
}
