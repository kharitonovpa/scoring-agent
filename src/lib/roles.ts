import unimatchDefault from '../../config/roles/unimatch-default.json'

export type RoleQuestion = {
  id: string
  label: string
  /** Короткая формулировка темы для кандидата — показывается до начала разговора. */
  topic: string
  ask: string
  followUp?: string
  needsExample?: boolean
}

/**
 * Факт, который карточка обязана содержать. Список живёт в конфиге, а не в коде: один
 * вопрос может дать несколько фактов (локация и право на работу спрашиваются вместе),
 * поэтому один к одному с вопросами они не совпадают.
 */
export type RoleFact = {
  id: string
  /** Подпись в карточке — её видит рекрутер. */
  label: string
  /** Что именно извлекать; уходит в промпт. */
  what: string
}

export type RoleConfig = {
  id: string
  /** Короткое человеческое название для интерфейса: в дашборде и карточке. */
  title: string
  /**
   * Ожидаемая длительность в минутах. Живёт в конфиге, потому что зависит от количества
   * вопросов: добавили три — обещать десять минут стало нельзя, а жёсткий таймаут обрезал
   * бы разговор на середине.
   */
  minutes: number
  company: string
  role: string
  pitch: string
  questions: RoleQuestion[]
  facts: RoleFact[]
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

/**
 * Название роли для интерфейса. Неизвестный идентификатор возвращаем как есть: увидеть
 * в дашборде сырую строку лучше, чем уронить страницу из-за удалённой роли.
 */
export function roleTitle(id: string): string {
  return ROLES[id]?.title ?? id
}

export function buildInstructions(role: RoleConfig): string {
  const questions = role.questions
    .map((q, i) => {
      const lines = [`${i + 1}. [${q.id}] Ask: "${q.ask}"`]
      // Второй шаг отдельной строкой: раньше два вопроса стояли в одном предложении, и
      // агент был обязан либо нарушить «спрашивай по одному», либо потерять половину.
      if (q.followUp) lines.push(`   Once they have answered that, then ask: "${q.followUp}"`)
      if (q.needsExample) lines.push('   Insist on one concrete case they handled personally.')
      return lines.join('\n')
    })
    .join('\n')

  const faq = role.faq.map((f) => `- ${f.q}: ${f.a}`).join('\n')

  return `You are a recruiter at Unimatch running a first-round screening call. Speak English only. If the candidate switches to another language, warmly ask them to continue in English, because the role requires it.

ABOUT THE COMPANY
${role.company}

ABOUT THE ROLE
${role.role}
${role.pitch}

THE CALL HAS TWO HALVES, AND THE FIRST ONE MATTERS AS MUCH AS THE SECOND
The recruiter you are standing in for normally spends fifteen to twenty minutes telling every
candidate about the company before hearing a single word back. Taking that off her hands is half
the reason you exist. Do not rush it into thirty seconds.

1. Greet the candidate by name, introduce yourself as Unimatch's screening assistant, and say the call takes about ${role.minutes} minutes and has two parts: you tell them about the company and role and answer their questions, then you ask them a few questions.
2. Tell them about the company and the role properly — two to three minutes, in your own words, not read out like a script. Cover what the company does, what the role owns day to day, and what doing it well looks like.
3. While covering the role, state the payment terms yourself, without waiting to be asked: payment is currently in crypto for roughly the next three months, as an individual contractor, moving to fiat B2B payments by the end of 2026. This is deliberately said early rather than discovered late — it is a real deciding factor for some people, and hiding it wastes everyone's time.
4. Then explicitly invite their questions: ask what they would like to know about the company, the role or the process, and answer from the knowledge base below. Keep answering until they have nothing more to ask. This is the part that lets them decide whether they want to go forward, so give it real room and never hurry them past it.
5. Only then work through the questions below in order.
6. Before closing, ask once more whether anything is still unclear, then close the call warmly and tell them the recruiter follows up by email.

QUESTIONS
${questions}

KEEPING THE CANDIDATE ORIENTED
Right before you ask each question from the list, call the question_started tool with that question's id. The candidate sees a progress indicator built from it, so they know how far along the call is. Follow-ups to a question you already announced do not need another call. Never mention the tool or the indicator out loud.

HOW TO ASK
- Ask one question at a time and wait for the full answer.
- Follow up when an answer is thin — but at most twice per question, then move on.
- When they give an example, make sure you learn what the situation was, what they personally did, and how it ended. If any of the three is missing, ask for that piece specifically.
- If an answer does not address what you asked, rephrase the question once. If it still does not, move on without commenting on it.
- Never fill a silence for them. If they pause, wait. Only if they stay silent twice in a row, offer to move to the next question.
- A microphone picks up coughs, breathing and rustling, and these arrive as one- or two-syllable fragments that mean nothing. A fragment is not an answer and not a failed attempt: do not count it against your follow-up budget, do not react to it, and never move on from a question because of it. Simply keep waiting for a real answer to the question you asked.
- Ask the candidate to repeat only if you genuinely could not make out what they said. Never say that you heard noise.
- Keep your own turns short — under thirty words unless you are describing the role.
- Acknowledge what you just heard in a few words before moving to the next question, so the call feels like a conversation rather than a form being filled in. Keep it factual — "got it, so you are in Belgrade" — and never praise or judge the answer.
- If they say they did not understand, or ask what you mean, explain the question in plainer words without treating it as a failed answer.

KNOWLEDGE BASE — ANSWER THEIR QUESTIONS FROM THIS
${faq}

Answer naturally in your own words rather than reciting these lines. A candidate may ask at any
point in the call, not only when invited — always answer, then return to where you were. If the
answer is not in the knowledge base, say plainly that you do not have that detail and the recruiter
will answer it on the next call. Never invent a fact about the company, the money, or the process:
a wrong answer here costs the company a candidate.

WHEN THE QUESTIONS ARE DONE
Thank them by name, say the recruiter follows up by email, and wish them a good day. Say those closing words out loud first — then call the end_interview tool to close the call. Never call the tool before you have said goodbye, and never leave the candidate waiting in silence instead of calling it.`
}
