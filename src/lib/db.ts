import { neon } from '@neondatabase/serverless'
import type { Card, Metrics, SessionRecord, SessionStatus, Turn } from './types'

const sql = neon(process.env.DATABASE_URL!)

type Row = {
  id: string
  candidate_name: string
  role_id: string
  consent_at: string
  status: SessionStatus
  started_at: string
  ended_at: string | null
  transcript: Turn[]
  metrics: Metrics | null
  card: Card | null
  audio_chunks: string[]
  audio_url: string | null
  audio_offset_sec: number | null
}

function toRecord(row: Row): SessionRecord {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    roleId: row.role_id,
    consentAt: row.consent_at,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    transcript: row.transcript ?? [],
    metrics: row.metrics,
    card: row.card,
    audioChunks: row.audio_chunks ?? [],
    audioUrl: row.audio_url,
    audioOffsetSec: row.audio_offset_sec,
  }
}

export async function createSession(input: { candidateName: string; roleId: string }) {
  const rows = (await sql`
    INSERT INTO sessions (candidate_name, role_id)
    VALUES (${input.candidateName}, ${input.roleId})
    RETURNING id
  `) as { id: string }[]
  return rows[0].id
}

export async function getSession(id: string) {
  const rows = (await sql`SELECT * FROM sessions WHERE id = ${id}`) as Row[]
  return rows[0] ? toRecord(rows[0]) : null
}

export async function listSessions() {
  const rows = (await sql`
    SELECT id, candidate_name, role_id, status, started_at, ended_at
    FROM sessions ORDER BY started_at DESC
  `) as Row[]
  return rows.map((r) => ({
    id: r.id,
    candidateName: r.candidate_name,
    roleId: r.role_id,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }))
}

/** Сдвиг записывается, только если передан: промежуточные сохранения его не затирают. */
export async function saveTurns(id: string, turns: Turn[], audioOffsetSec?: number | null) {
  await sql`
    UPDATE sessions
    SET transcript = ${JSON.stringify(turns)}::jsonb,
        audio_offset_sec = COALESCE(${audioOffsetSec ?? null}, audio_offset_sec)
    WHERE id = ${id}
  `
}

export async function finishSession(id: string, status: SessionStatus) {
  await sql`UPDATE sessions SET status = ${status}, ended_at = now() WHERE id = ${id}`
}

export async function setStatus(id: string, status: SessionStatus) {
  await sql`UPDATE sessions SET status = ${status} WHERE id = ${id}`
}

export async function addAudioChunk(id: string, url: string) {
  await sql`
    UPDATE sessions SET audio_chunks = audio_chunks || ${JSON.stringify([url])}::jsonb
    WHERE id = ${id}
  `
}

/** Ставится только после ремукса: карточка играет перематываемый файл. */
export async function setAudioUrl(id: string, url: string) {
  await sql`UPDATE sessions SET audio_url = ${url} WHERE id = ${id}`
}

/** Для мягкого лимита на прогоны: демо-ссылка публичная, а квота одна. */
export async function countSessionsSince(since: Date) {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM sessions WHERE started_at > ${since.toISOString()}
  `) as { n: number }[]
  return rows[0].n
}

export async function saveAnalysis(id: string, metrics: Metrics, card: Card) {
  await sql`
    UPDATE sessions
    SET metrics = ${JSON.stringify(metrics)}::jsonb,
        card    = ${JSON.stringify(card)}::jsonb,
        status  = 'analyzed'
    WHERE id = ${id}
  `
}
