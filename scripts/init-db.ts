import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

await sql`
  CREATE TABLE IF NOT EXISTS sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_name   text        NOT NULL,
    role_id          text        NOT NULL,
    consent_at       timestamptz NOT NULL DEFAULT now(),
    status           text        NOT NULL DEFAULT 'live',
    started_at       timestamptz NOT NULL DEFAULT now(),
    ended_at         timestamptz,
    transcript       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    metrics          jsonb,
    card             jsonb,
    audio_chunks     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    audio_url        text,
    audio_offset_sec double precision
  )
`

// Отдельным шагом, чтобы поле появилось и на уже существующей таблице.
await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS used_push_to_talk boolean NOT NULL DEFAULT false`

console.log('schema ready')
