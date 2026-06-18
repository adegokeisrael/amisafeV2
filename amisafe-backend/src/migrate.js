// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Migration runner
//  Usage: node src/migrate.js
// ═══════════════════════════════════════════════════════════════
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const migrations = [
  '../sql/001_schema.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const file of migrations) {
      const sql = readFileSync(join(__dirname, file), 'utf8');
      console.log(`Running migration: ${file}`);
      await client.query(sql);
      console.log(`✓ Done`);
    }
    console.log('\nAll migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
