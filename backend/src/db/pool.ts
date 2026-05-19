import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (see .env.example)');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon and Supabase require SSL; local Postgres usually doesn't.
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
});

// Convenience wrapper for typed queries
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
