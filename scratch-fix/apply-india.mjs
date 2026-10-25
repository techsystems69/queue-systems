// One-off: apply migration 20260906_school_token_locale.sql to the india DB
// (snhcwqayrtrvhdxxtiuo) via the ap-south-1 session pooler.
//
//   cd /home/akshay/Projects/queue-system && node scratch-fix/apply-india.mjs
//
// Reads SUPABASE_DB_PASSWORD from .env.local. Snapshots the two functions it
// replaces to scratch-fix/rollback_india_20260906.sql, applies the migration in
// a single transaction, reloads the PostgREST cache, and verifies.

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const ROOT = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD not in .env.local')

const client = new pg.Client({
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.snhcwqayrtrvhdxxtiuo',
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

await client.connect()
console.log('connected to snhcwqayrtrvhdxxtiuo\n')

// 1. Snapshot the functions this migration drops/replaces (rollback safety)
const snap = await client.query(`
  SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('claim_school_token', 'get_public_ticket_status')
`)
const rollbackPath = path.join(ROOT, 'scratch-fix', 'rollback_india_20260906.sql')
fs.writeFileSync(rollbackPath,
  `-- pre-migration snapshot of snhcwqayrtrvhdxxtiuo taken ${new Date().toISOString()}\n` +
  `-- to roll back: DROP the 5-arg claim_school_token, then run the statements below.\n\n` +
  snap.rows.map(r => `-- ${r.sig}\n${r.def};\n`).join('\n'))
console.log('rollback snapshot ->', rollbackPath)
console.log('  captured:', snap.rows.map(r => r.sig).join(', '), '\n')

// 2. Apply the migration in one transaction
const sql = fs.readFileSync(path.join(ROOT, 'scratch-fix', '20260906_school_token_locale.sql'), 'utf8')
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('migration COMMITTED\n')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('migration FAILED — rolled back, nothing changed:\n ', e.message)
  await client.end()
  process.exit(1)
}

// 3. Reload PostgREST's schema cache so the new signature is callable via REST
await client.query(`NOTIFY pgrst, 'reload schema'`)
console.log("NOTIFY pgrst 'reload schema' sent\n")

// 4. Verify
const sigs = await client.query(`
  SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'claim_school_token'
`)
const col = await client.query(`
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'school_tokens' AND column_name = 'locale'
`)
console.log('claim_school_token signature(s):', sigs.rows.map(r => r.sig).join(' | '))
console.log('school_tokens.locale present  :', col.rowCount > 0)
console.log('\nExpected: claim_school_token(uuid,uuid,text,boolean,text)  +  locale present')

await client.end()
