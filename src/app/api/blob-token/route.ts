import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getSession } from '@/lib/db'

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload приходит от клиента и доверия не заслуживает: проверяем,
        // что сессия существует и что путь принадлежит именно ей.
        const sessionId = String(clientPayload ?? '')
        if (!sessionId || !(await getSession(sessionId))) throw new Error('Unknown session')
        if (!pathname.startsWith(`interviews/${sessionId}/`)) throw new Error('Bad pathname')
        return {
          allowedContentTypes: ['audio/webm', 'video/webm', 'audio/mp4'],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: 50 * 1024 * 1024,
          tokenPayload: sessionId,
        }
      },
      // Вебхук на localhost не срабатывает, поэтому URL регистрирует сам клиент
      // через /api/audio/register. Здесь коллбэк оставлен пустым намеренно.
      onUploadCompleted: async () => {},
    })
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
