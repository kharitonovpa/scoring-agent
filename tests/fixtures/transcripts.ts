import type { Turn } from '@/lib/types'

const turn = (
  id: string,
  speaker: Turn['speaker'],
  text: string,
  tStart: number,
  tEnd: number,
): Turn => ({
  id,
  speaker,
  text,
  tStart,
  tEnd,
  timingSource: speaker === 'candidate' ? 'server' : 'client',
})

/** Структурный кандидат: отвечает по существу, в примере есть ситуация, действие и результат. */
export const strongCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based, and can you work as a contractor?', 0, 4),
  turn(
    'c1',
    'candidate',
    'I am based in Lisbon, and yes, I have been invoicing as a contractor for three years, so the paperwork side is familiar to me.',
    5,
    14,
  ),
  turn('a2', 'agent', 'Tell me about your experience with students, then one specific case.', 15, 19),
  turn(
    'c2',
    'candidate',
    'I spent two years at an education agency handling applications end to end. One student had been rejected twice and came to me in June with a September deadline. I rebuilt her list around three programmes that actually matched her grades, rewrote her personal statement with her over four sessions, and chased the referee who was holding things up. She was admitted in August, and she started that autumn.',
    21,
    72,
  ),
  turn('a3', 'agent', 'What working setup are you looking for?', 73, 76),
  turn(
    'c3',
    'candidate',
    'Full time and fully remote suits me best. I have worked across time zones before, so overlapping a few hours a day is something I am used to organising.',
    77,
    89,
  ),
  turn('a4', 'agent', 'When could you start?', 90, 92),
  turn(
    'c4',
    'candidate',
    'Three weeks from now, because I need to wrap up my current contract properly and hand over my caseload.',
    93,
    101,
  ),
]

/** Слабая структура: уходит от вопроса, говорит много, но в примере нет ни действия, ни результата. */
export const weakCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based, and can you work as a contractor?', 0, 4),
  turn(
    'c1',
    'candidate',
    'I am very interested in this role, it is exactly what I am looking for right now, and I think the company is doing really meaningful work in education.',
    5,
    17,
  ),
  turn('a2', 'agent', 'Sure — but where are you based?', 18, 21),
  turn('c2', 'candidate', 'In Europe, more or less, it depends on the season really.', 22, 28),
  turn('a3', 'agent', 'Tell me about a specific case you handled.', 29, 32),
  turn(
    'c3',
    'candidate',
    'We did a lot of work with students, the team was really good and everyone was happy with the results. There were a lot of applications and we handled them together, and the feedback was positive overall, which was nice to see for everyone involved.',
    34,
    66,
  ),
  turn('a4', 'agent', 'What did you personally do in that case?', 67, 70),
  turn(
    'c4',
    'candidate',
    'Mostly supporting the process, whatever was needed at the time, so a bit of everything really depending on what came up that week.',
    71,
    88,
  ),
]

/** Похоже на зачитанное: письменный синтаксис в одном ответе, живая речь с запинками в остальных. */
export const readingCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based?', 0, 3),
  turn(
    'c1',
    'candidate',
    'Um, yeah, so, I am in, uh, Warsaw right now, I moved here like, two years ago I think.',
    4,
    12,
  ),
  turn('a2', 'agent', 'Tell me about a specific case you handled.', 13, 16),
  turn(
    'c2',
    'candidate',
    'Throughout my professional tenure I have consistently demonstrated an unwavering commitment to facilitating optimal outcomes for stakeholders, leveraging a comprehensive skill set encompassing strategic communication, meticulous attention to detail, and a proactive approach to problem resolution, thereby ensuring the successful realisation of institutional objectives across a diverse portfolio of applicants.',
    24,
    66,
  ),
  turn('a3', 'agent', 'And what was the result in that particular case?', 67, 70),
  turn(
    'c3',
    'candidate',
    'Uh, the result, um, it was, yeah, it was good I think, like, they were happy with it, uh, I do not remember the exact numbers to be honest.',
    78,
    94,
  ),
]

/** Ниже порога достаточности: односложные ответы. Оценка языка и манеры выдаваться не должна. */
export const oneWordCandidate: Turn[] = [
  turn('a1', 'agent', 'Where are you based?', 0, 3),
  turn('c1', 'candidate', 'Berlin.', 4, 5),
  turn('a2', 'agent', 'Can you work as a contractor there?', 6, 9),
  turn('c2', 'candidate', 'Yes.', 10, 11),
  turn('a3', 'agent', 'Tell me about a case you handled.', 12, 15),
  turn('c3', 'candidate', 'Many cases.', 16, 18),
]
