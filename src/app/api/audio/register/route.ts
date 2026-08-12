import { addAudioChunk, getSession } from '@/lib/db'

const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

export async function POST(req: Request) {
  let payload: { sessionId?: string; url?: string }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const { sessionId, url } = payload
  if (!sessionId || !url) {
    return Response.json({ error: 'sessionId and url are required' }, { status: 400 })
  }

  // Роут открытый, поэтому принимаем только адреса своего же хранилища и только
  // те, что лежат в папке этой сессии.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Response.json({ error: 'url is not a URL' }, { status: 400 })
  }
  if (
    !parsed.hostname.endsWith(BLOB_HOST_SUFFIX) ||
    !parsed.pathname.includes(`/interviews/${sessionId}/`)
  ) {
    return Response.json({ error: 'url does not belong to this session' }, { status: 400 })
  }

  if (!(await getSession(sessionId))) return Response.json({ error: 'Unknown session' }, { status: 404 })

  await addAudioChunk(sessionId, url)
  return Response.json({ ok: true })
}
