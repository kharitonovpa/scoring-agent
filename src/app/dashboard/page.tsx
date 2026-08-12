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
          Пока пусто.{' '}
          <Link href="/interview" className="underline">
            Пройти интервью
          </Link>
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
                <tr key={s.id} className="border-t border-neutral-200">
                  <td className="py-2.5 font-medium">{s.candidateName}</td>
                  <td className="py-2.5 text-neutral-600">{s.roleId}</td>
                  <td className="py-2.5 text-neutral-600">
                    {new Date(s.startedAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="py-2.5">
                    <span className={`rounded px-2 py-0.5 text-xs ${status.className}`}>
                      {status.label}
                    </span>
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
