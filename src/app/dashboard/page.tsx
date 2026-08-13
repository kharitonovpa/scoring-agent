import Link from 'next/link'
import { listSessions } from '@/lib/db'
import { roleTitle } from '@/lib/roles'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; className: string }> = {
  live: { label: 'идёт', className: 'bg-blue-100 text-blue-800' },
  interrupted: { label: 'прервано', className: 'bg-amber-100 text-amber-800' },
  analyzing: { label: 'анализ', className: '' },
  analyzed: { label: 'готово', className: 'bg-green-100 text-green-800' },
  failed: { label: 'ошибка', className: 'bg-red-100 text-red-800' },
}

export default async function DashboardPage() {
  const sessions = await listSessions()

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-5 py-10 sm:px-6">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Скрининги</h1>
        <p className="mt-1 text-sm text-ink-soft">{sessions.length} всего</p>
      </header>

      {sessions.length === 0 ? (
        <p className="surface p-8 text-center text-ink-soft">
          Пока пусто.{' '}
          <Link href="/interview" className="text-accent underline">
            Пройти интервью
          </Link>
        </p>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
          <thead className="border-b border-line bg-paper text-left text-ink-soft">
            <tr>
              <th className="px-4 py-3 font-medium">Кандидат</th>
              <th className="px-4 py-3 font-medium">Роль</th>
              <th className="px-4 py-3 font-medium">Когда</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const status = STATUS[s.status] ?? { label: s.status, className: '' }
              return (
                <tr key={s.id} className="border-t border-line transition-colors hover:bg-paper">
                  <td className="px-4 py-3 font-medium">{s.candidateName}</td>
                  <td className="px-4 py-3 text-ink-soft">{roleTitle(s.roleId)}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {new Date(s.startedAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`chip ${status.className}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/card/${s.id}`} className="text-accent underline underline-offset-2">
                      карточка
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      <p className="pt-2 text-xs text-ink-faint">
        Демо: доступ без авторизации. В продакшене этот список закрыт логином — см. DECISIONS.md.
      </p>
    </main>
  )
}
