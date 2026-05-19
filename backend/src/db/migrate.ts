import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool } from './pool';

async function migrate() {
  const dir = join(__dirname, '..', '..', 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  console.log(`Found ${files.length} migration file(s).`);
  for (const file of files) {
    console.log(`Running ${file}…`);
    const sql = readFileSync(join(dir, file), 'utf8');
    await pool.query(sql);
  }
  console.log('Migrations complete.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
