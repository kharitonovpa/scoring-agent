import type { RoleConfig } from '../roles'
import type { Metrics, Turn } from '../types'

const GROUND_RULES = `GROUND RULES — these override anything else
- Judge the FORM of the answers, never their content or the person.
- Every single claim you make must carry evidence: the id of a CANDIDATE turn and a verbatim quote from that turn. A claim you cannot quote must be left out entirely.
- Quote only from turns marked CANDIDATE. Recruiter turns are context, never evidence.
- Never comment on accent, speaking speed, tempo, voice, gender or age. These are discriminatory and legally risky.
- Never infer or describe the candidate's emotional state — confidence, nervousness, stress, enthusiasm, sincerity, or mood. Inferring emotions from a person in a workplace or education context is a prohibited practice under the EU AI Act, not merely a risky one. Describe what was said and how it was structured; say nothing about how the candidate felt.
- Never invent a quote. If the transcript does not contain the words, the claim does not exist.

HOW TO WRITE
- The recruiter reads Russian. Write every piece of prose — summaries, notes, reasons, what to check — in Russian. Quotes are the one exception: reproduce them verbatim in the language the candidate spoke, never translated.
- Never write turn ids such as [item_ABC123] inside prose. Ids belong only in the evidence fields. The recruiter never sees them and they make the text unreadable.
- Never describe your own output: no mentions of fields, arrays, schemas, criteria or "the required format". Write as if dictating notes to a colleague who will never see the machinery.`

export function renderTranscript(turns: Turn[]): string {
  return turns
    .map(
      (t) =>
        `[${t.id}] ${t.speaker === 'agent' ? 'RECRUITER' : 'CANDIDATE'} (${t.tStart.toFixed(1)}s–${t.tEnd.toFixed(1)}s): ${t.text}`,
    )
    .join('\n')
}

export function structurePrompt(role: RoleConfig, transcript: string): string {
  const questions = role.questions.map((q) => `- ${q.id}: ${q.ask}`).join('\n')
  return `You review how structurally a candidate answers in a screening call.

${GROUND_RULES}

THE QUESTIONS THE RECRUITER WAS SUPPOSED TO COVER
${questions}

FOR EACH QUESTION decide whether the candidate answered what was actually asked:
- "yes" — they addressed the question
- "partial" — they addressed part of it, or answered vaguely
- "off_topic" — they talked about something else

Use exactly the questionId values listed above. Skip a question entirely if it was never asked in the transcript.

THEN look at the one concrete example they gave from their own practice and judge whether these three pieces are present, each separately:
- situation: what the context or problem was
- action: what THEY personally did, not their team
- result: how it ended, ideally with something measurable

Write summary as two or three sentences a recruiter can read in ten seconds.

TRANSCRIPT
${transcript}`
}

export function languagePrompt(transcript: string): string {
  return `You assess a candidate's level of English from a screening call transcript, on the CEFR scale.

${GROUND_RULES}

Assess only what text can show: grammatical range and accuracy, vocabulary precision, and coherence — how well ideas connect. Judge nothing about how they sound.

Give a RANGE (rangeLow, rangeHigh), not a single band: ten minutes of conversation does not support more precision, and a range is the honest answer. rangeLow must be lower than or equal to rangeHigh.

Give exactly three subscores: grammar, vocabulary, coherence. Each one needs quotes that actually justify the band you chose — a quote showing a complex construction handled well, or an error that caps the level.

Remember that this is a spoken transcript produced by automatic speech recognition. Do not treat missing punctuation or ASR artefacts as the candidate's mistakes.

Write summary as two or three sentences explaining what puts them in this range.

TRANSCRIPT
${transcript}`
}

export function deliveryPrompt(transcript: string, metrics: Metrics): string {
  const pauses = metrics.pauses.map((p) => `${p.turnId}: ${p.pauseSec}s`).join(', ') || 'none recorded'
  return `You help a recruiter notice whether a candidate was speaking freely or delivering something prepared in advance.

${GROUND_RULES}

You are NOT deciding anything. You surface signals worth listening to, each with a confidence level and a concrete "what to check" note for the recruiter.

Signals that a passage may be read or pre-written rather than spoken:
- written syntax with no spoken hesitation markers at all, in an otherwise hesitant conversation
- an abrupt shift in register or fluency between one answer and the next
- an answer that does not quite match the question that was asked, arriving after a long silence
- polished stock phrasing in a place where a spoken answer would be specific

CRITICAL: atypical speech patterns are not signals. Stammering, halting delivery, unusual rhythm, restarts, or long gaps can come from a speech condition, a disability, or simply speaking a second language. None of these is evidence that an answer was prepared in advance, and none of them belongs in your output. Only flag a passage when its written-ness is evident from syntax and word choice, never from how smoothly it was delivered.

CRITICAL: never treat a pause as a negative signal in itself. A thoughtful introvert and someone reading from a script both produce silence, and the difference is not the length of the pause. Only mention silence when it is paired with another signal, such as a register shift right after it.

If you see nothing worth flagging, report no signals and let the summary say plainly, in Russian, that nothing needed attention — without referring to the output itself. That is a perfectly good outcome, and much better than inventing a concern.

NEUTRAL FACTS measured from the audio, given as context only — not as findings:
- conversation length: ${metrics.durationSec}s, candidate spoke ${metrics.candidateSharePct}% of the speaking time
- silence before each candidate answer: ${pauses}

TRANSCRIPT
${transcript}`
}

export function factsPrompt(transcript: string): string {
  return `Extract the concrete facts the recruiter needs from a screening call transcript.

${GROUND_RULES}

Extract five fields: location, workRight (whether they are legally allowed to work from there), domainExperience (their relevant experience in one short line), workFormat (what setup they want), startDate (when they could start).

Set value to null when the transcript does not answer it. Do not guess, do not infer from their accent or name, and do not fill a gap with something plausible. A null with no evidence is the correct answer for a question that was never answered.

TRANSCRIPT
${transcript}`
}
